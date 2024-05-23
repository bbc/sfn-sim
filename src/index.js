import { getValue, setValue } from './util';
import runChoice from './choice';
import runTask from './task';

// TODO error types
// TODO intrinsic functions
// TODO parameters
// TODO resultselector
// TODO retry, catch

const load = (definition, resources = [], options = {}) => {
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
      throw new Error('Failed');
    }

    const stateInput = getValue(rawInput, state.InputPath || '$');
    let stateResult = {};

    if (state.Type === 'Succeed') {
      stateResult = stateInput;
    }

    if (state.Type === 'Choice') {
      const next = runChoice(state, context, stateInput);

      rawInput = getValue(stateInput, state.OutputPath || '$');
      state = definition.States[next];
      continue;
    }

    if (state.Type === 'Parallel') {
      const branches = state.Branches.map((branch) => execute(branch, context, stateInput));
      stateResult = await Promise.all(branches);

      stateResult = applyResultPath(rawInput, stateResult, state.ResultPath);
    }

    if (state.Type === 'Map') {
      const items = jq.value(stateInput, state.ItemsPath || '$');

      const executions = items.map((item) => execute(state.ItemProcessor, context, item));
      stateResult = await Promise.all(executions);

      stateResult = applyResultPath(rawInput, stateResult, state.ResultPath);
    }

    if (state.Type === 'Wait') {
      if (options.simulateWait) {
        const duration = state.Seconds * 1000;
        await new Promise(resolve => setTimeout(resolve, duration));
      }

      stateResult = stateInput;
    }

    if (state.Type === 'Task') {
      stateResult = await runTask(state, context, stateInput);

      stateResult = applyResultPath(rawInput, stateResult, state.ResultPath);
    }

    if (state.Type === 'Pass') {
      stateResult = stateInput;

      stateResult = applyResultPath(rawInput, stateResult, state.ResultPath);
    }

    const stateOutput = getValue(stateResult, state.OutputPath || '$');

    if (state.End || state.Type === 'Succeed') {
      return stateOutput;
    }

    rawInput = stateOutput;
    state = definition.States[state.Next];
  }
};

const applyResultPath = (rawInput, stateResult, resultPath) => {
  let input = { ...rawInput };
  
  if (resultPath !== null) {
    if (resultPath) {
      setValue(input, resultPath, stateResult);
    } else {
      input = stateResult;
    }
  }
  return input;
};

export {
  load,
};
