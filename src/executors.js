import runChoice from './choice.js';
import { RuntimeError, FailError, ERROR_WILDCARD } from './errors.js';
import runTask from './task.js';
import { getValue, applyPayloadTemplate, getStateResult, wait, evaluateJSONata } from './utils.js';

const executeFail = (state, variables, _simulatorContext) => {
  const rawInput = variables.states.input;

  const error = state.Error || (state.ErrorPath ? getValue(rawInput, state.ErrorPath) : null);
  const cause = state.Cause || (state.CausePath ? getValue(rawInput, state.CausePath) : null);

  throw new FailError(error, cause);
};

const executeSucceed = (state, variables, _simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);

  const stateOutput = getValue(stateInput, state.OutputPath);

  return [stateOutput, null];
};

const executeChoice = (state, variables, _simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);

  const next = runChoice(state, stateInput);

  const stateOutput = getValue(stateInput, state.OutputPath);

  return [stateOutput, next];
};

const executeParallel = async (state, variables, simulatorContext) => {
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
          Execution: {
            ...variables.states.context.Execution,
            Input: effectiveInput,
          },
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

const executeMap = async (state, variables, simulatorContext) => {
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
          Execution: {
            ...variables.states.context.Execution,
            Input: Value,
          },
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

const executeTask = async (state, variables, simulatorContext) => {
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

const executeWait = async (state, variables, simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);

  const seconds = state.Seconds || (state.SecondsPath ? getValue(stateInput, state.SecondsPath) : null);
  if (!seconds) {
    throw new RuntimeError('Could not resolve value of Seconds or SecondsPath in Wait step');
  }

  await wait(state.Seconds, simulatorContext);

  const stateOutput = getValue(stateInput, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

const executePass = (state, variables, _simulatorContext) => {
  const rawInput = variables.states.input;
  const stateInput = getValue(rawInput, state.InputPath);
  const effectiveInput = applyPayloadTemplate(stateInput, variables.states.context, state.Parameters);

  const result = state.Result || effectiveInput;

  const stateResult = getStateResult(rawInput, result, state.ResultPath);
  const stateOutput = getValue(stateResult, state.OutputPath);

  const next = state.End ? null : state.Next;

  return [stateOutput, next];
};

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
  Fail: executeFail,
  Succeed: executeSucceed,
  Choice: executeChoice,
  Parallel: withRetry(executeParallel),
  Map: withRetry(executeMap),
  Task: withRetry(executeTask),
  Wait: executeWait,
  Pass: executePass,
};

const executeStateMachine = async (definition, variables, simulatorContext) => {
  while (true) {
    variables.states.context.State.EnteredTime = new Date().toISOString();

    const state = definition.States[variables.states.context.State.Name];
    const executor = executors[state.Type];

    if (!executor) {
      throw new RuntimeError(`Unrecognised state Type ${state.Type}`);
    }

    const [output, nextState] = await executor(state, variables, simulatorContext);

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
