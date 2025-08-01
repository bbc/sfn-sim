import { runJSONPathChoice, runJSONataChoice } from './choice.js';
import { RuntimeError, FailError, ERROR_WILDCARD } from './errors.js';
import runTask from './task.js';
import { getValue, applyPayloadTemplate, getStateResult, wait, evaluateJSONata, getJSONataInput, getJSONataOutput, assign } from './utils.js';

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

  const Payload = await runTask(state, simulatorContext, input);

  const taskVariables = {
    ...variables,
    states: {
      ...variables.states,
      result: {
        Payload,
      },
    },
  };

  await assign(state, taskVariables);

  const output = await getJSONataOutput(state, taskVariables);

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

  await assign(state, variables);

  const output = await getJSONataOutput(state, variables, result);

  const next = state.End ? null : state.Next;

  return [output, next];
};

const executeMapJSONata = async (state, variables, simulatorContext) => {
  const items = await evaluateJSONata(state.Items, variables);

  // TODO ItemReader, ItemBatcher, ResultWriter, ToleratedFailure

  const executions = items.map(async (Value, Index) => {
    const itemVariables = {
      ...variables,
      states: {
        ...variables.states,
        input: Value,
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
      const input = await evaluateJSONata(state.ItemSelector, itemVariables);
      itemVariables.states.input = input;
      itemVariables.states.context.Execution.Input = input;
    }

    return executeStateMachine(state.ItemProcessor, itemVariables, simulatorContext);
  });

  const result = await Promise.all(executions);

  const mapVariables = {
    ...variables,
    states: {
      ...variables.states,
      result,
    },
  };

  await assign(state, mapVariables);

  const output = await getJSONataOutput(state, mapVariables, result);

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

const executeMapJSONPath = async (state, variables, simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, variables.states.context, state.Parameters);

  const items = getValue(effectiveInput, state.ItemsPath);

  const executions = items.map((Value, Index) => {
    const itemVariables = {
      ...variables,
      states: {
        ...variables.states,
        input: Value,
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

    return executeStateMachine(state.ItemProcessor, itemVariables, simulatorContext);
  });

  const result = await Promise.all(executions);

  const effectiveResult = applyPayloadTemplate(result, variables.states.context, state.ResultSelector);
  const stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

/*
* general
*/

const withRetry = (executor) => async (state, variables, simulatorContext) => {
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

            await wait(interval, simulatorContext);

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
          const stateOutput = getStateResult(rawInput, error.toErrorOutput(), catcher.ResultPath);

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
    Task: withRetry(executeTaskJSONata),
    Choice: executeChoiceJSONata,
    Wait: executeWaitJSONata,
    Succeed: executeSucceedJSONata,
    Fail: executeFailJSONata,
    Parallel: withRetry(executeParallelJSONata),
    Map: withRetry(executeMapJSONata),
  },
  JSONPath: {
    Pass: executePassJSONPath,
    Task: withRetry(executeTaskJSONPath),
    Choice: executeChoiceJSONPath,
    Wait: executeWaitJSONPath,
    Succeed: executeSucceedJSONPath,
    Fail: executeFailJSONPath,
    Parallel: withRetry(executeParallelJSONPath),
    Map: withRetry(executeMapJSONPath),
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
