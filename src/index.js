import { StateLint } from '@wmfs/statelint';
import { v4 as uuidV4 } from 'uuid';
import { ValidationError } from './errors.js';
import { defaultOptions } from './options.js';
import { executeStateMachine } from './executors.js';

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
          QueryLanguage: definition.QueryLanguage || 'JSONPath',
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

      return executeStateMachine(definition, data);
    },
  };
};

export {
  load,
};
