import { runJSONPathChoice, runJSONataChoice } from './choice.js';
import { v4 as uuidV4 } from 'uuid';
import {
  RuntimeError,
  FailError,
  ExceedToleratedFailureThresholdError,
  ItemReaderFailedError,
  ERROR_WILDCARD,
} from './errors.js';
import runTask from './task.js';
import { getValue, applyPayloadTemplate, getStateResult, wait, evaluateJSONata, getJSONataInput, getJSONataOutput, assign } from './utils.js';
import { createHash } from 'node:crypto';

/*
* JSONata
*/

const executePassJSONata = async (state, variables, _simulatorContext) => {
  await assign(state, variables);

  const output = await getJSONataOutput(state, variables);

  const next = state.End ? null : state.Next;

  return [output, next];
};

const executeTaskJSONata = async (state, variables, simulatorContext) => {
  const input = await getJSONataInput(state, variables);

  const result = await runTask(state, simulatorContext, input, 'JSONata');

  variables.states.result = result;

  await assign(state, variables);

  const output = await getJSONataOutput(state, variables, result);

  const next = state.End ? null : state.Next;

  return [output, next];
};

const executeChoiceJSONata = async (state, variables, simulatorContext) => {
  const [output, next] = await runJSONataChoice(state, variables, simulatorContext);

  return [output, next];
};

const executeWaitJSONata = async (state, variables, simulatorContext) => {
  const seconds = await evaluateJSONata(state.Seconds, variables) ?? null;
  const timestamp = await evaluateJSONata(state.Timestamp, variables) ?? null;

  if (!seconds && !timestamp) {
    throw new RuntimeError('No Seconds or Timestamp specified in Wait step');
  }

  await wait(seconds, timestamp, simulatorContext);

  await assign(state, variables);

  const output = getJSONataOutput(state, variables);

  const next = state.End ? null : state.Next;

  return [output, next];
};

const executeSucceedJSONata = async (state, variables, _simulatorContext) => {
  const output = await getJSONataOutput(state, variables);

  return [output, null];
};

const executeFailJSONata = async (state, variables, _simulatorContext) => {
  const error = state.Error ? await evaluateJSONata(state.Error, variables) : null;
  const cause = state.Cause ? await evaluateJSONata(state.Cause, variables) : null;

  throw new FailError(error, cause);
};

const executeParallelJSONata = async (state, variables, simulatorContext) => {
  const input = await getJSONataInput(state, variables);

  const branches = state.Branches.map((branch) => {
    const branchVariables = {
      ...variables,
      states: {
        ...variables.states,
        input,
        context: {
          ...variables.states.context,
          State: {
            ...variables.states.context.State,
            Name: branch.StartAt,
          },
        },
      },
    };

    return executeStateMachine(branch, branchVariables, simulatorContext);
  });

  const result = await Promise.all(branches);

  variables.states.result = result;

  await assign(state, variables);

  const output = await getJSONataOutput(state, variables, result);

  const next = state.End ? null : state.Next;

  return [output, next];
};

const getItemReaderPointerValue = (value, pointer) => {
  if (!pointer || pointer === '/') {
    return value;
  }

  if (!pointer.startsWith('/')) {
    throw new RuntimeError('ItemReader ReaderConfig.ItemsPointer must start with "/"');
  }

  const segments = pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'));

  return segments.reduce((current, segment) => {
    if (current === undefined || current === null) {
      throw new RuntimeError('ItemReader ReaderConfig.ItemsPointer did not match any data');
    }
    return current[segment];
  }, value);
};

const shapeS3ObjectListItem = (entry, lastModified) => {
  if (typeof entry.body !== 'string') {
    throw new RuntimeError('S3 object body must be a string');
  }

  return {
    ETag: createHash('md5').update(entry.body).digest('hex'),
    Key: entry.key,
    LastModified: lastModified,
    Size: new TextEncoder().encode(entry.body).length,
    StorageClass: 'STANDARD',
  };
};

const mapSettledResultsToOutput = (settledResults) => settledResults.map((entry) => {
  if (entry.status === 'fulfilled') {
    return entry.value;
  }

  const reason = entry.reason;
  if (reason?.toErrorOutput) {
    return reason.toErrorOutput();
  }

  return {
    Error: reason?.name || 'Error',
    Cause: reason?.stack || reason?.message,
  };
});

const isFailureThresholdExceeded = ({
  totalItems,
  failedItems,
  toleratedFailureCount,
  toleratedFailurePercentage,
}) => {
  const failedPercentage = totalItems === 0 ? 0 : (failedItems / totalItems) * 100;
  const countExceeded = toleratedFailureCount !== null && failedItems > toleratedFailureCount;
  const percentageExceeded = toleratedFailurePercentage !== null && failedPercentage > toleratedFailurePercentage;

  return countExceeded || percentageExceeded;
};

const getMapChildExecutionContext = (state, variables, itemInput) => {
  if (state.ItemProcessor.ProcessorConfig?.Mode !== 'DISTRIBUTED') {
    return variables.states.context.Execution;
  }

  const mapRunId = uuidV4();
  const parentExecutionName = variables.states.context.Execution?.Name;
  const mapStateIdentifier = (state.Label || variables.states.context.State?.Name || 'Map').replace(/\s+/g, '');
  const childExecutionName = parentExecutionName
    ? `${parentExecutionName}/${mapStateIdentifier}:${mapRunId}`
    : `${mapStateIdentifier}:${mapRunId}`;

  return {
    Id: mapRunId,
    Input: itemInput,
    Name: childExecutionName,
    StartTime: new Date().toISOString(),
    RedriveCount: 0,
  };
};

const getMapItemsFromItemReaderJSONata = async (state, variables, simulatorContext) => {
  try {
    const { ItemReader } = state;
    const readerInput = ItemReader.Arguments
      ? await evaluateJSONata(ItemReader.Arguments, variables)
      : (ItemReader.Parameters || variables.states.input);

    const s3Resource = simulatorContext.resources.find(
      ({ service, name }) => service === 's3' && name === readerInput.Bucket,
    );

    if (!s3Resource) {
      throw new RuntimeError('ItemReader failed to find configured S3 bucket resource');
    }

    let items;
    const isS3GetObjectReader = [
      'arn:aws:states:::s3:getObject',
      'arn:aws:states:::aws-sdk:s3:getObject',
    ].includes(ItemReader.Resource);
    const isS3ListObjectsReader = [
      'arn:aws:states:::s3:listObjectsV2',
      'arn:aws:states:::aws-sdk:s3:listObjectsV2',
    ].includes(ItemReader.Resource);

    if (isS3GetObjectReader) {
      // TODO JSONL, CSV, MANIFEST, PARQUET
      const inputType = ItemReader.ReaderConfig?.InputType || 'JSON';
      if (inputType !== 'JSON') {
        throw new RuntimeError(`Unsupported ItemReader ReaderConfig.InputType [${inputType}]`);
      }

      const object = s3Resource.objects?.find((entry) => entry.key === readerInput.Key);

      if (!object) {
        throw new RuntimeError('ItemReader failed to load the configured S3 object');
      }

      items = object.body;
      if (typeof items === 'string') {
        items = JSON.parse(items);
      } else {
        throw new RuntimeError('ItemReader S3 object body must be a string');
      }

      const itemsPointer = ItemReader.ReaderConfig?.ItemsPointer;
      if (itemsPointer) {
        items = getItemReaderPointerValue(items, itemsPointer);
      }
    } else if (isS3ListObjectsReader) {

      const prefix = readerInput.Prefix || '';
      const now = new Date().toISOString();

      // TODO Support Transformation === "LOAD_AND_FLATTEN"

      items = (s3Resource.objects || [])
        .filter((entry) => entry.key.startsWith(prefix))
        .map((entry) => shapeS3ObjectListItem(entry, now));
    } else {
      throw new RuntimeError(`Unsupported ItemReader Resource [${ItemReader.Resource}]`);
    }

    if (!Array.isArray(items)) {
      throw new RuntimeError('ItemReader must resolve to an array of items');
    }

    const maxItems = ItemReader.ReaderConfig?.MaxItems !== undefined
      ? await evaluateJSONata(ItemReader.ReaderConfig.MaxItems, variables)
      : null;

    if (maxItems !== null && maxItems !== undefined) {
      return items.slice(0, maxItems);
    }

    return items;
  } catch (error) {
    if (error instanceof ItemReaderFailedError) {
      throw error;
    }
    throw new ItemReaderFailedError(error?.message || error);
  }
};

const getMapItemsJSONata = async (state, variables, simulatorContext) => {
  if (!state.ItemReader) {
    return evaluateJSONata(state.Items, variables);
  }

  if (state.ItemProcessor.ProcessorConfig?.Mode !== 'DISTRIBUTED') {
    throw new RuntimeError('ItemReader is not supported for INLINE map states');
  }

  const itemReaderItems = await getMapItemsFromItemReaderJSONata(state, variables, simulatorContext);

  if (!state.Items) {
    return itemReaderItems;
  }

  const itemReaderVariables = {
    ...variables,
    states: {
      ...variables.states,
      input: itemReaderItems,
    },
  };

  return evaluateJSONata(state.Items, itemReaderVariables);
};

const applyItemBatcherJSONata = async (itemBatcher, items, variables) => {
  if (!itemBatcher) {
    return items;
  }
  
  // TODO MaxInputBytesPerBatch

  let maxItemsPerBatch = null;
  if (itemBatcher.MaxItemsPerBatch !== undefined) {
    maxItemsPerBatch = await evaluateJSONata(itemBatcher.MaxItemsPerBatch, variables);
  }

  if (maxItemsPerBatch !== null && (!Number.isInteger(maxItemsPerBatch) || maxItemsPerBatch <= 0)) {
    throw new RuntimeError('ItemBatcher MaxItemsPerBatch must resolve to a positive integer');
  }

  const batchInput = itemBatcher.BatchInput !== undefined
    ? await evaluateJSONata(itemBatcher.BatchInput, variables)
    : undefined;

  const batches = [];
  const batchSize = maxItemsPerBatch || items.length || 1;
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = {
      Items: items.slice(index, index + batchSize),
    };

    if (batchInput !== undefined) {
      batch.BatchInput = batchInput;
    }

    batches.push(batch);
  }

  return batches;
};

const executeMapJSONata = async (state, variables, simulatorContext) => {
  // Map-level JSONata fields should resolve $states.input to the map state's input.
  const parentInput = variables.states.input;

  // Get the items to process, either from Items or via an ItemReader
  let items = await getMapItemsJSONata(state, variables, simulatorContext);

  // If there is only a single item returned by the JSONata expression, wrap it in an array.
  // This is AWS Step Function behaviour to coerce scalar expressions to single element arrays to facilitate mapping.
  if (!Array.isArray(items)) {
    items = [items];
  } 

  // Resolve ItemSelector against the items to process
  const selectedItems = await Promise.all(items.map(async (Value, Index) => {
    const itemVariables = {
      ...variables,
      states: {
        ...variables.states,
        // $states.input is the input to the map state when ItemSelector is resolving the items to process.
        input: parentInput,
        context: {
          ...variables.states.context,
          State: {
            ...variables.states.context.State,
            Name: state.ItemProcessor.StartAt,
          },
          Map: {
            Item: {
              Index,
              Value,
            },
          },
        },
      },
    };

    if (state.ItemSelector) {
      return evaluateJSONata(state.ItemSelector, itemVariables);
    }

    return Value;
  }));

  // Batch the items if an ItemBatcher is configured
  const executionInputs = await applyItemBatcherJSONata(state.ItemBatcher, selectedItems, variables);

  // Execute the child workflows for each item or batch
  const executions = executionInputs.map(async (Value, Index) => {
    const childExecution = getMapChildExecutionContext(state, variables, Value);

    const itemVariables = {
      ...variables,
      states: {
        ...variables.states,
        // $states.input is the input to the child workflow when it is executing.
        input: Value,
        context: {
          ...variables.states.context,
          Execution: childExecution,
          State: {
            ...variables.states.context.State,
            Name: state.ItemProcessor.StartAt,
          },
          Map: {
            Item: {
              Index,
              Value,
            },
          },
        },
      },
    };
    return executeStateMachine(state.ItemProcessor, itemVariables, simulatorContext);
  });

  // Check failure thresholds

  // TODO MaxConcurrency
  const settledResults = await Promise.allSettled(executions);
  const failedResults = settledResults.filter((entry) => entry.status === 'rejected');

  const toleratedFailureCount = state.ToleratedFailureCount !== undefined
    ? await evaluateJSONata(state.ToleratedFailureCount, variables)
    : null;
  const toleratedFailurePercentage = state.ToleratedFailurePercentage !== undefined
    ? await evaluateJSONata(state.ToleratedFailurePercentage, variables)
    : null;

  const hasFailureThreshold = toleratedFailureCount !== null || toleratedFailurePercentage !== null;
  if (failedResults.length > 0 && !hasFailureThreshold) {
    throw failedResults[0].reason;
  }

  if (toleratedFailureCount !== null && (!Number.isInteger(toleratedFailureCount) || toleratedFailureCount < 0)) {
    throw new RuntimeError('ToleratedFailureCount must resolve to a non-negative integer');
  }
  if (
    toleratedFailurePercentage !== null
    && (typeof toleratedFailurePercentage !== 'number' || toleratedFailurePercentage < 0 || toleratedFailurePercentage > 100)
  ) {
    throw new RuntimeError('ToleratedFailurePercentage must resolve to a number between 0 and 100');
  }

  const totalItems = settledResults.length;
  const failedItems = failedResults.length;
  if (isFailureThresholdExceeded({
    totalItems,
    failedItems,
    toleratedFailureCount,
    toleratedFailurePercentage,
  })) {
    throw new ExceedToleratedFailureThresholdError();
  }

  // TODO ResultWriter
  const result = mapSettledResultsToOutput(settledResults);

  variables.states.result = result;

  await assign(state, variables);

  const output = await getJSONataOutput(state, variables, result);

  const next = state.End ? null : state.Next;

  return [output, next];
};

/*
* JSONPath
*/

const executePassJSONPath = (state, variables, _simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, variables.states.context, state.Parameters);

  const result = state.Result || effectiveInput;

  const stateResult = getStateResult(rawInput, result, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const executeTaskJSONPath = async (state, variables, simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, variables.states.context, state.Parameters);

  const result = await runTask(state, simulatorContext, effectiveInput);

  const effectiveResult = applyPayloadTemplate(result, variables.states.context, state.ResultSelector);
  const stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const executeChoiceJSONPath = async (state, variables, simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);

  const next = runJSONPathChoice(state, stateInput, simulatorContext);

  const stateOutput = getValue(stateInput, state.OutputPath);

  return [stateOutput, next];
};

const executeWaitJSONPath = async (state, variables, simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);

  const seconds = state.Seconds || (state.SecondsPath ? getValue(stateInput, state.SecondsPath) : null);
  const timestamp = state.Timestamp || (state.TimestampPath ? getValue(stateInput, state.TimestampPath) : null);

  if (!seconds && !timestamp) {
    throw new RuntimeError('No Seconds/SecondsPath or Timestamp/TimestampPath specified in Wait step');
  }

  await wait(seconds, timestamp, simulatorContext);

  const stateOutput = getValue(stateInput, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const executeSucceedJSONPath = (state, variables, _simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);

  const stateOutput = getValue(stateInput, state.OutputPath);

  return [stateOutput, null];
};

const executeFailJSONPath = (state, variables, _simulatorContext) => {
  const rawInput = variables.states.input;

  const error = state.Error || (state.ErrorPath ? getValue(rawInput, state.ErrorPath) : null);
  const cause = state.Cause || (state.CausePath ? getValue(rawInput, state.CausePath) : null);

  throw new FailError(error, cause);
};

const executeParallelJSONPath = async (state, variables, simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, variables.states.context, state.Parameters);

  const branches = state.Branches.map((branch) => {
    const branchVariables = {
      ...variables,
      states: {
        ...variables.states,
        input: effectiveInput,
        context: {
          ...variables.states.context,
          State: {
            ...variables.states.context.State,
            Name: branch.StartAt,
          },
        },
      },
    };

    return executeStateMachine(branch, branchVariables, simulatorContext);
  });

  const result = await Promise.all(branches);

  const effectiveResult = applyPayloadTemplate(result, variables.states.context, state.ResultSelector);
  const stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};


const getMapItemsFromItemReaderJSONPath = (state, stateInput, context, simulatorContext) => {
  try {
    const { ItemReader } = state;
    const readerInput = ItemReader.Parameters
      ? applyPayloadTemplate(stateInput, context, ItemReader.Parameters)
      : stateInput;

    const s3Resource = simulatorContext.resources.find(
      ({ service, name }) => service === 's3' && name === readerInput.Bucket,
    );

    if (!s3Resource) {
      throw new RuntimeError('ItemReader failed to find configured S3 bucket resource');
    }

    let items;
    const isS3GetObjectReader = [
      'arn:aws:states:::s3:getObject',
      'arn:aws:states:::aws-sdk:s3:getObject',
    ].includes(ItemReader.Resource);
    const isS3ListObjectsReader = [
      'arn:aws:states:::s3:listObjectsV2',
      'arn:aws:states:::aws-sdk:s3:listObjectsV2',
    ].includes(ItemReader.Resource);

    if (isS3GetObjectReader) {
      const inputType = ItemReader.ReaderConfig?.InputType || 'JSON';
      if (inputType !== 'JSON') {
        throw new RuntimeError(`Unsupported ItemReader ReaderConfig.InputType [${inputType}]`);
      }

      const object = s3Resource.objects?.find((entry) => entry.key === readerInput.Key);
      if (!object) {
        throw new RuntimeError('ItemReader failed to load the configured S3 object');
      }

      items = object.body;
      if (typeof items === 'string') {
        items = JSON.parse(items);
      } else {
        throw new RuntimeError('ItemReader S3 object body must be a string');
      }

      const itemsPointer = ItemReader.ReaderConfig?.ItemsPointer;
      if (itemsPointer) {
        items = getItemReaderPointerValue(items, itemsPointer);
      }
    } else if (isS3ListObjectsReader) {
      const prefix = readerInput.Prefix || '';
      const now = new Date().toISOString();
      items = (s3Resource.objects || [])
        .filter((entry) => entry.key.startsWith(prefix))
        .map((entry) => shapeS3ObjectListItem(entry, now));
    } else {
      throw new RuntimeError(`Unsupported ItemReader Resource [${ItemReader.Resource}]`);
    }

    if (!Array.isArray(items)) {
      throw new RuntimeError('ItemReader must resolve to an array of items');
    }

    const maxItems = ItemReader.ReaderConfig?.MaxItems || null;
    const maxItemsPath = ItemReader.ReaderConfig?.MaxItemsPath || null;

    if (maxItemsPath !== null && maxItems !== null) {
      throw new RuntimeError('ItemReader ReaderConfig.MaxItems and ReaderConfig.MaxItemsPath cannot be used together');
    }

    let maxItemsValue = null;
    if (maxItemsPath !== null) {
      maxItemsValue = getValue(stateInput, maxItemsPath);
    } else if (maxItems !== null) {
      if (maxItems !== null && (!Number.isInteger(maxItems) || maxItems <= 0)) {
        throw new RuntimeError('ItemReader ReaderConfig.MaxItems must resolve to a positive integer');
      }
      maxItemsValue = maxItems;
    }

    if (maxItemsValue !== null) {
      return items.slice(0, maxItemsValue);
    }

    return items;
  } catch (error) {
    if (error instanceof ItemReaderFailedError) {
      throw error;
    }
    throw new ItemReaderFailedError(error?.message || error);
  }
};

const getMapItemsJSONPath = (state, stateInput, effectiveInput, context, simulatorContext) => {
  if (!state.ItemReader) {
    return getValue(effectiveInput, state.ItemsPath);
  }

  if (state.ItemProcessor.ProcessorConfig?.Mode !== 'DISTRIBUTED') {
    throw new RuntimeError('ItemReader is not supported for INLINE map states');
  }

  const itemReaderItems = getMapItemsFromItemReaderJSONPath(state, stateInput, context, simulatorContext);

  if (!state.ItemsPath) {
    return itemReaderItems;
  }

  return getValue(itemReaderItems, state.ItemsPath);
};

const applyItemBatcherJSONPath = (itemBatcher, items, stateInput, context) => {
  if (!itemBatcher) {
    return items;
  }

  // TODO MaxInputBytesPerBatch, MaxInputBytesPerBatchPath

  const maxItemsPerBatch = itemBatcher.MaxItemsPerBatch ?? null;
  const maxItemsPerBatchPath = itemBatcher.MaxItemsPerBatchPath ?? null;

  if (maxItemsPerBatch !== null && maxItemsPerBatchPath !== null) {
    throw new RuntimeError('ItemBatcher MaxItemsPerBatch and MaxItemsPerBatchPath cannot be used together');
  }

  let maxItemsPerBatchValue;

  if (maxItemsPerBatchPath !== null) {
    maxItemsPerBatchValue = getValue(stateInput, maxItemsPerBatchPath);
  } else if (maxItemsPerBatch !== null) {
    if (maxItemsPerBatch !== null && (!Number.isInteger(maxItemsPerBatch) || maxItemsPerBatch <= 0)) {
      throw new RuntimeError('ItemBatcher MaxItemsPerBatch must resolve to a positive integer');
    }

    maxItemsPerBatchValue = maxItemsPerBatch;
  }

  const batchInput = itemBatcher.BatchInput !== undefined
    ? applyPayloadTemplate(stateInput, context, itemBatcher.BatchInput)
    : undefined;

  const batches = [];
  const batchSize = maxItemsPerBatchValue || items.length || 1;
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = {
      Items: items.slice(index, index + batchSize),
    };
    if (batchInput !== undefined) {
      batch.BatchInput = batchInput;
    }
    batches.push(batch);
  }

  return batches;
};

const executeMapJSONPath = async (state, variables, simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, variables.states.context, state.Parameters);
  let items = getMapItemsJSONPath(state, stateInput, effectiveInput, variables.states.context, simulatorContext);

  // If there is only a single item returned by the JSONpath evaluation, wrap it in an array.
  // This is AWS Step Function behaviour to coerce scalar expressions to single element arrays to facilitate mapping.
  if (!Array.isArray(items)) {
    items = [items];
  } 

  const selectedItems = items.map((Value, Index) => {
    if (!state.ItemSelector) {
      return Value;
    }

    const itemContext = {
      ...variables.states.context,
      State: {
        ...variables.states.context.State,
        Name: state.ItemProcessor.StartAt,
      },
      Map: {
        Item: {
          Index,
          Value,
        },
      },
    };

    return applyPayloadTemplate(effectiveInput, itemContext, state.ItemSelector);
  });

  const executionInputs = applyItemBatcherJSONPath(
    state.ItemBatcher,
    selectedItems,
    effectiveInput,
    variables.states.context,
  );

  const executions = executionInputs.map((Value, Index) => {
    const childExecution = getMapChildExecutionContext(state, variables, Value);

    const itemVariables = {
      ...variables,
      states: {
        ...variables.states,
        input: Value,
        context: {
          ...variables.states.context,
          Execution: childExecution,
          State: {
            ...variables.states.context.State,
            Name: state.ItemProcessor.StartAt,
          },
          Map: {
            Item: {
              Index,
              Value,
            },
          },
        },
      },
    };
    return executeStateMachine(state.ItemProcessor, itemVariables, simulatorContext);
  });

  const settledResults = await Promise.allSettled(executions);
  const failedResults = settledResults.filter((entry) => entry.status === 'rejected');

  const toleratedFailureCount = state.ToleratedFailureCount
    ?? (state.ToleratedFailureCountPath ? getValue(effectiveInput, state.ToleratedFailureCountPath) : null);
  const toleratedFailurePercentage = state.ToleratedFailurePercentage
    ?? (state.ToleratedFailurePercentagePath ? getValue(effectiveInput, state.ToleratedFailurePercentagePath) : null);

  const hasFailureThreshold = toleratedFailureCount !== null || toleratedFailurePercentage !== null;
  if (failedResults.length > 0 && !hasFailureThreshold) {
    throw failedResults[0].reason;
  }

  if (toleratedFailureCount !== null && (!Number.isInteger(toleratedFailureCount) || toleratedFailureCount < 0)) {
    throw new RuntimeError('ToleratedFailureCount must resolve to a non-negative integer');
  }
  if (
    toleratedFailurePercentage !== null
    && (typeof toleratedFailurePercentage !== 'number' || toleratedFailurePercentage < 0 || toleratedFailurePercentage > 100)
  ) {
    throw new RuntimeError('ToleratedFailurePercentage must resolve to a number between 0 and 100');
  }

  const totalItems = settledResults.length;
  const failedItems = failedResults.length;
  if (isFailureThresholdExceeded({
    totalItems,
    failedItems,
    toleratedFailureCount,
    toleratedFailurePercentage,
  })) {
    throw new ExceedToleratedFailureThresholdError();
  }

  const result = mapSettledResultsToOutput(settledResults);
  const effectiveResult = applyPayloadTemplate(result, variables.states.context, state.ResultSelector);
  const stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

/*
* general
*/

const withRetry = (executor, queryLanguage) => async (state, variables, simulatorContext) => {
  const rawInput = variables.states.input;

  const retriers = (state.Retry || []).map((retrier) => ({
    ...retrier,
    remainingAttempts: retrier.MaxAttempts || 3,
    currentInterval: retrier.IntervalSeconds || 1,
    BackoffRate: retrier.BackoffRate || 2,
  }));

  retry: while (true) {
    try {
      const result = await executor(state, variables, simulatorContext);

      return result;
    } catch (error) {
      for (const retrier of retriers) {
        if (retrier.ErrorEquals.includes(error.name) || retrier.ErrorEquals.includes(ERROR_WILDCARD)) {
          if (retrier.remainingAttempts > 0) {
            const interval = retrier.MaxDelaySeconds
              ? Math.min(retrier.currentInterval, retrier.MaxDelaySeconds)
              : retrier.currentInterval;

            await wait(interval, null, simulatorContext);

            retrier.currentInterval = retrier.currentInterval * retrier.BackoffRate;
            retrier.remainingAttempts--;
            continue retry;
          } else {
            break;
          }
        }
      }

      for (const catcher of state.Catch || []) {
        if (catcher.ErrorEquals.includes(error.name) || catcher.ErrorEquals.includes(ERROR_WILDCARD)) {
          const errorOutput = error?.toErrorOutput ? error.toErrorOutput() : ({
            Error: error?.name,
            Cause: error?.message,
          });

          let stateOutput;
          if (queryLanguage === 'JSONata') {
            const catchVariables = {
              ...variables,
              states: {
                ...variables.states,
                errorOutput,
              },
            };
            stateOutput = await getJSONataOutput(catcher, catchVariables); // TODO check if a catch has a default Output
            await assign(catcher, catchVariables);
          } else {
            stateOutput = getStateResult(rawInput, errorOutput, catcher.ResultPath);
          }

          const next = catcher.Next;

          return [stateOutput, next];
        }
      }

      throw error;
    }
  }
};

const executors = {
  JSONata: {
    Pass: executePassJSONata,
    Task: withRetry(executeTaskJSONata, 'JSONata'),
    Choice: executeChoiceJSONata,
    Wait: executeWaitJSONata,
    Succeed: executeSucceedJSONata,
    Fail: executeFailJSONata,
    Parallel: withRetry(executeParallelJSONata, 'JSONata'),
    Map: withRetry(executeMapJSONata, 'JSONata'),
  },
  JSONPath: {
    Pass: executePassJSONPath,
    Task: withRetry(executeTaskJSONPath, 'JSONPath'),
    Choice: executeChoiceJSONPath,
    Wait: executeWaitJSONPath,
    Succeed: executeSucceedJSONPath,
    Fail: executeFailJSONPath,
    Parallel: withRetry(executeParallelJSONPath, 'JSONPath'),
    Map: withRetry(executeMapJSONPath, 'JSONPath'),
  },
};

const executeStateMachine = async (definition, variables, simulatorContext) => {
  while (true) {
    variables.states.context.State.EnteredTime = new Date().toISOString();

    const state = definition.States[variables.states.context.State.Name];

    const queryLanguage = state.QueryLanguage || simulatorContext.queryLanguage;

    const execute = executors[queryLanguage][state.Type];

    if (!execute) {
      throw new RuntimeError(`Unrecognised state Type ${state.Type}`);
    }

    const [output, nextState] = await execute(state, variables, simulatorContext);

    variables.states.result = undefined;

    if (!nextState) {
      return output;
    }

    variables.states.input = output;
    variables.states.context.State.Name = nextState;
  }
};

export {
  executeStateMachine,
};
