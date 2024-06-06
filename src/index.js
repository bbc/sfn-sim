import { StateLint } from '@wmfs/statelint';
import runChoice from './choice';
import { ValidationError, RuntimeError, FailError } from './errors';
import { defaultOptions } from './options';
import runTask from './task';
import { getValue, applyPayloadTemplate, getStateResult } from './utils';

const load = (definition, resources = [], overrideOptions = {}) => {
  const options = {
    ...defaultOptions,
    ...overrideOptions,
  };

  if (options.validateDefinition) {
    const stateLint = new StateLint();
    const problems = stateLint.validate(definition);
  
    if (problems.length) {
      const message = problems.join('\n');
      throw new ValidationError(message);
    }
  }

  const context = { resources, options };

  return {
    execute: (input) => execute(definition, context, input),
  };
};

const execute = async (definition, context, input) => {
  let rawInput = input || {};
  let state = definition.States[definition.StartAt];

  while (true) {
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
      const next = runChoice(state, context, stateInput);

      rawInput = getValue(stateInput, state.OutputPath);
      state = definition.States[next];
      continue;
    }

    if (state.Type === 'Parallel') {
      const effectiveInput = applyPayloadTemplate(stateInput, state.Parameters);

      const branches = state.Branches.map((branch) => execute(branch, context, effectiveInput));
      const result = await Promise.all(branches);

      const effectiveResult = applyPayloadTemplate(result, state.ResultSelector);

      stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
    }

    if (state.Type === 'Map') {
      const effectiveInput = applyPayloadTemplate(stateInput, state.Parameters);

      const items = getValue(effectiveInput, state.ItemsPath);

      const executions = items.map((item) => execute(state.ItemProcessor, context, item));
      const result = await Promise.all(executions);

      const effectiveResult = applyPayloadTemplate(result, state.ResultSelector);

      stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
    }

    if (state.Type === 'Wait') {
      const seconds = state.Seconds || (state.SecondsPath ? getValue(stateInput, state.SecondsPath) : null);

      if (!seconds) {
        throw new RuntimeError('Could not resolve value of Seconds or SecondsPath in Wait step');
      }

      if (context.options.simulateWait) {
        const duration = state.Seconds * 1000;
        await new Promise(resolve => setTimeout(resolve, duration));
      }

      stateResult = stateInput;
    }

    if (state.Type === 'Task') {
      const effectiveInput = applyPayloadTemplate(stateInput, state.Parameters);

      const result = await runTask(state, context, effectiveInput);

      const effectiveResult = applyPayloadTemplate(result, state.ResultSelector);

      stateResult = getStateResult(rawInput, effectiveResult, state.ResultPath);
    }

    if (state.Type === 'Pass') {
      const effectiveInput = applyPayloadTemplate(stateInput, state.Parameters);

      stateResult = getStateResult(rawInput, effectiveInput, state.ResultPath);
    }

    const stateOutput = getValue(stateResult, state.OutputPath);

    if (state.End || state.Type === 'Succeed') {
      return stateOutput;
    }

    rawInput = stateOutput;
    state = definition.States[state.Next];
  }
};

export {
  load,
};
