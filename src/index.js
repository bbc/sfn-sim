import { StateLint } from '@wmfs/statelint';
import { v4 as uuidV4 } from 'uuid';
import { ValidationError } from './errors.js';
import { defaultOptions } from './options.js';
import { executeStateMachine } from './executors.js';
import { getTaskToken } from './utils.js';

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
    execute: (input) => {
      const queryLanguage = definition.QueryLanguage || 'JSONPath';

      const Token = getTaskToken();

      const context = {
        Execution: {
          Id: uuidV4(),
          Input: input,
          Name: executionName,
          StartTime: new Date().toISOString(),
          // RedriveCount:,
          // RedriveTime:,
        },
        State: {
          // EnteredTime:,
          Name: definition.StartAt,
          // RetryCount:,
        },
        StateMachine: {
          Id: uuidV4(),
          Name: stateMachineName,
        },
        Task: {
          Token,
        },
      };

      const variables = {
        states: {
          input,
          context,
        },
      };

      const simulatorContext = { resources, options, queryLanguage };

      return executeStateMachine(definition, variables, simulatorContext);
    },
  };
};

export {
  load,
};
