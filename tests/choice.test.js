import { test, expect } from 'vitest';
import runChoice from '../src/choice.js';
import { NoChoiceMatchedError } from '../src/errors.js';

test('returns a matched step from the given Choices', () => {
  const state = {
    Type: 'Choice',
    Choices: [
      {
        Variable: '$.someString',
        StringEquals: 'Hello!',
        Next: 'MatchedStep',
      },
    ],
    Default: 'DefaultStep',
  };

  const input = {
    someString: 'Hello!',
  };

  const nextState = runChoice(state, {}, input);

  expect(nextState).toEqual('MatchedStep');
});

test('returns the Default step when no choices match', () => {
  const state = {
    Type: 'Choice',
    Choices: [
      {
        Variable: '$.someString',
        StringEquals: 'Hello!',
        Next: 'MatchedStep',
      },
    ],
    Default: 'DefaultStep',
  };

  const input = {
    someString: 'Goodbye!',
  };

  const nextState = runChoice(state, {}, input);

  expect(nextState).toEqual('DefaultStep');
});

test('throws a States.NoChoiceMatched error when no choices match and no Default is specified', () => {
  const state = {
    Type: 'Choice',
    Choices: [
      {
        Variable: '$.someString',
        StringEquals: 'Hello!',
        Next: 'MatchedStep',
      },
    ],
  };

  const input = {
    someString: 'Goodbye!',
  };

  expect(() => runChoice(state, {}, input)).toThrowError(NoChoiceMatchedError);
});
