import runChoice from './choice.js';
import { RuntimeError, FailError, ERROR_WILDCARD } from './errors.js';
import runTask from './task.js';
import { getValue, applyPayloadTemplate, getStateResult, wait } from './utils.js';

const executeFail = (state, _data, rawInput) => {
  const error = state.Error || (state.ErrorPath ? getValue(rawInput, state.ErrorPath) : null);
  const cause = state.Cause || (state.CausePath ? getValue(rawInput, state.CausePath) : null);

  throw new FailError(error, cause);
};

const executeSucceed = (state, _data, rawInput) => {
  const stateInput = getValue(rawInput, state.InputPath);

  const stateOutput = getValue(stateInput, state.OutputPath);

  return [stateOutput, null];
};

const executeChoice = (state, data, rawInput) => {
  const stateInput = getValue(rawInput, state.InputPath);

  const next = runChoice(state, data, stateInput);

  const stateOutput = getValue(stateInput, state.OutputPath);

  return [stateOutput, next];
};

const executeParallel = async (state, data, rawInput) => {
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, data, state.Parameters);

  const branches = state.Branches.map((branch) => {
    const branchData = {
      ...data,
      context: {
        ...data.context,
        Execution: {
          ...data.context.Execution,
          Input: effectiveInput,
        },
        State: {
          ...data.context.State,
          Name: branch.StartAt,
        },
      },
    };

    return executeStateMachine(branch, branchData);
  });

  const result = await Promise.all(branches);

  const effectiveResult = applyPayloadTemplate(result, data, state.ResultSelector);
  const stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const executeMap = async (state, data, rawInput) => {
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, data, state.Parameters);

  const items = getValue(effectiveInput, state.ItemsPath);

  const executions = items.map((Value, Index) => {
    const itemData = {
      ...data,
      context: {
        ...data.context,
        Execution: {
          ...data.context.Execution,
          Input: Value,
        },
        State: {
          ...data.context.State,
          Name: state.ItemProcessor.StartAt,
        },
        Map: {
          Item: {
            Index,
            Value,
          },
        },
      },
    };

    return executeStateMachine(state.ItemProcessor, itemData);
  });

  const result = Promise.all(executions);

  const effectiveResult = applyPayloadTemplate(result, data, state.ResultSelector);
  const stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const executeTask = async (state, data, rawInput) => {
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, data, state.Parameters);

  const result = await runTask(state, data, effectiveInput);

  const effectiveResult = applyPayloadTemplate(result, data, state.ResultSelector);
  const stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const executeWait = async (state, data, rawInput) => {
  const stateInput = getValue(rawInput, state.InputPath);

  const seconds = state.Seconds || (state.SecondsPath ? getValue(stateInput, state.SecondsPath) : null);
  if (!seconds) {
    throw new RuntimeError('Could not resolve value of Seconds or SecondsPath in Wait step');
  }

  await wait(state.Seconds, data);

  const stateOutput = getValue(stateInput, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const executePass = (state, data, rawInput) => {
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, data, state.Parameters);

  const result = state.Result || effectiveInput;

  const stateResult = getStateResult(rawInput, result, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const withRetry = (executor) => async (state, data, rawInput) => {
  const retriers = (state.Retry || []).map((retrier) => ({
    ...retrier,
    remainingAttempts: retrier.MaxAttempts || 3,
    currentInterval: retrier.IntervalSeconds || 1,
    BackoffRate: retrier.BackoffRate || 2,
  }));

  retry: while (true) {
    try {
      const result = await executor(state, data, rawInput);

      return result;
    } catch (error) {
      for (const retrier of retriers) {
        if (retrier.ErrorEquals.includes(error.name) || retrier.ErrorEquals.includes(ERROR_WILDCARD)) {
          if (retrier.remainingAttempts > 0) {
            const interval = retrier.MaxDelaySeconds
              ? Math.min(retrier.currentInterval, retrier.MaxDelaySeconds)
              : retrier.currentInterval;

            await wait(interval, data);

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
  Fail: executeFail,
  Succeed: executeSucceed,
  Choice: executeChoice,
  Parallel: withRetry(executeParallel),
  Map: withRetry(executeMap),
  Task: withRetry(executeTask),
  Wait: executeWait,
  Pass: executePass,
};

const executeStateMachine = async (definition, data) => {
  let rawInput = data.context.Execution.Input || {};

  while (true) {
    data.context.State.EnteredTime = new Date().toISOString();

    const state = definition.States[data.context.State.Name];
    const executor = executors[state.Type];

    if (!executor) {
      throw new RuntimeError(`Unrecognised state Type ${state.Type}`);
    }

    const [stateOutput, nextState] = await executor(state, data, rawInput);

    if (!nextState) {
      return stateOutput;
    }

    rawInput = stateOutput;
    data.context.State.Name = nextState;
  }
};

export {
  executeStateMachine,
};
