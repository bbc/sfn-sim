import { StateLint } from '@wmfs/statelint';
import { v4 as uuidV4 } from 'uuid';
import runChoice from './choice.js';
import { ValidationError, RuntimeError, FailError } from './errors.js';
import { defaultOptions } from './options.js';
import runTask from './task.js';
import { getValue, applyPayloadTemplate, getStateResult } from './utils.js';

const load = (definition, resources = [], overrideOptions = {}) => {
  const { executionName, stateMachineName, ...otherOverrideOptions } = overrideOptions;

  const options = {
    ...defaultOptions,
    ...otherOverrideOptions,
  };

  if (options.validateDefinition) {
    const stateLint = new StateLint();
    const problems = stateLint.validate(definition);
  
    if (problems.length) {
      const message = problems.join('\n');
      throw new ValidationError(message);
    }
  }

  return {
    execute: (Input) => {
      const context = {
        Execution: {
          Id: uuidV4(),
          Input,
          Name: executionName,
          StartTime: new Date().toISOString(),
        },
        State: {
          Name: definition.StartAt,
        },
        StateMachine: {
          Id: uuidV4(),
          Name: stateMachineName,
        },
        Task: {},
      };

      const data = { resources, options, context };

      return execute(definition, data);
    },
  };
};

const execute = async (definition, data) => {
  let rawInput = data.context.Execution.Input || {};

  while (true) {
    data.context.State.EnteredTime = new Date().toISOString();
    const state = definition.States[data.context.State.Name];

    if (state.Type === 'Fail') {
      const error = state.Error || (state.ErrorPath ? getValue(rawInput, state.ErrorPath) : null);
      const cause = state.Cause || (state.CausePath ? getValue(rawInput, state.CausePath) : null);

      throw new FailError(error, cause);
    }

    const stateInput = getValue(rawInput, state.InputPath);
    let stateResult = {};

    if (state.Type === 'Succeed') {
      stateResult = stateInput;
    }

    if (state.Type === 'Choice') {
      const next = runChoice(state, data, stateInput);

      rawInput = getValue(stateInput, state.OutputPath);
      data.context.State.Name = next;
      continue;
    }

    if (state.Type === 'Parallel') {
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

        return execute(branch, branchData);
      });
      const result = await Promise.all(branches);

      const effectiveResult = applyPayloadTemplate(result, data, state.ResultSelector);

      stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
    }

    if (state.Type === 'Map') {
      data.context
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

        return execute(state.ItemProcessor, itemData);
      });
      const result = await Promise.all(executions);

      const effectiveResult = applyPayloadTemplate(result, data, state.ResultSelector);

      stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
    }

    if (state.Type === 'Wait') {
      const seconds = state.Seconds || (state.SecondsPath ? getValue(stateInput, state.SecondsPath) : null);

      if (!seconds) {
        throw new RuntimeError('Could not resolve value of Seconds or SecondsPath in Wait step');
      }

      if (data.options.simulateWait) {
        const duration = state.Seconds * 1000;
        await new Promise(resolve => setTimeout(resolve, duration));
      }

      stateResult = stateInput;
    }

    if (state.Type === 'Task') {
      const effectiveInput = applyPayloadTemplate(stateInput, data, state.Parameters);

      const result = await runTask(state, data, effectiveInput);

      const effectiveResult = applyPayloadTemplate(result, data, state.ResultSelector);

      stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
    }

    if (state.Type === 'Pass') {
      const effectiveInput = applyPayloadTemplate(stateInput, data, state.Parameters);

      const result = state.Result || effectiveInput;

      stateResult = getStateResult(rawInput, result, state.ResultPath);
    }

    const stateOutput = getValue(stateResult, state.OutputPath);

    if (state.End || state.Type === 'Succeed') {
      return stateOutput;
    }

    rawInput = stateOutput;
    data.context.State.Name = state.Next;
  }
};

export {
  load,
};
