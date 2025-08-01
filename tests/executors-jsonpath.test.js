import { vi, describe, test, expect, beforeEach } from 'vitest';
import { v4 as uuidV4 } from 'uuid';
import { FailError, TaskFailedError } from '../src/errors.js';
import { executeStateMachine } from '../src/executors.js';
import { defaultOptions } from '../src/options.js';

const mockWait = vi.hoisted(() => vi.fn());

vi.mock('../src/utils.js', async () => ({
  ...(await vi.importActual('../src/utils.js')),
  wait: mockWait,
}));

const getVariables = (definition, input) => ({
  states: {
    input,
    context: {
      Execution: {
        Id: uuidV4(),
        Input: input,
        Name: 'test-execution',
        StartTime: new Date().toISOString(),
      },
      State: {
        Name: definition.StartAt,
      },
      StateMachine: {
        Id: uuidV4(),
        Name: 'test-state-machine',
      },
      Task: {},
    },
  },
});

const getSimulatorContext = (overrides = {}) => ({
  resources: [],
  options: defaultOptions,
  queryLanguage: 'JSONPath',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Pass', () => {
  test('returns given input if no Result specified', async () => {
    const definition = {
      StartAt: 'PassStep',
      States: {
        PassStep: {
          Type: 'Pass',
          End: true,
        },
      },
    };

    const input = { someString: 'hello' };
    const variables = getVariables(definition, input);
    const simulatorContext = getSimulatorContext();

    const result = await executeStateMachine(definition, variables, simulatorContext);

    expect(result).toEqual({ someString: 'hello' });
  });

  test('returns Result if specified', async () => {
    const definition = {
      StartAt: 'PassStep',
      States: {
        PassStep: {
          Type: 'Pass',
          Result: {
            someString: 'hello',
          },
          End: true,
        },
      },
    };

    const input = { someOtherString: 'goodbye' };
    const variables = getVariables(definition, input);
    const simulatorContext = getSimulatorContext();

    const result = await executeStateMachine(definition, variables, simulatorContext);

    expect(result).toEqual({ someString: 'hello' });
  });
});

test('executes a Task step', async () => {
  const definition = {
    StartAt: 'TaskStep',
    States: {
      TaskStep: {
        Type: 'Task',
        Resource: 'arn:aws:lambda:::function:my-function',
        End: true,
      },
    },
  };

  const mockLambda = vi.fn((input) => ({ someNumber: input.someNumber + 1 }));
  const resources = [
    {
      service: 'lambda',
      name: 'my-function',
      function: mockLambda,
    },
  ];

  const input = { someNumber: 2 };
  const variables = getVariables(definition, input);
  const simulatorContext = getSimulatorContext({ resources });

  const result = await executeStateMachine(definition, variables, simulatorContext);

  expect(mockLambda).toHaveBeenCalledWith({ someNumber: 2 });
  expect(result).toEqual({ someNumber: 3 });
});

test('executes a Choice step', async () => {
  const definition = {
    StartAt: 'ChoiceStep',
    States: {
      ChoiceStep: {
        Type: 'Choice',
        Choices: [
          {
            Variable: '$.shouldPass',
            BooleanEquals: true,
            Next: 'SucceedStep',
          },
        ],
        Default: 'FailStep',
      },
      SucceedStep: {
        Type: 'Succeed',
      },
      FailStep: {
        Type: 'Fail',
      },
    },
  };

  const input = { shouldPass: true };
  const variables = getVariables(definition, input);
  const simulatorContext = getSimulatorContext();

  const result = await executeStateMachine(definition, variables, simulatorContext);

  expect(result).toEqual({ shouldPass: true });
});

test('executes a Wait step', async () => {
  const definition = {
    StartAt: 'WaitStep',
    States: {
      WaitStep: {
        Type: 'Wait',
        Seconds: 5,
        End: true,
      },
    },
  };

  const input = { someString: 'hello' };
  const variables = getVariables(definition, input);
  const simulatorContext = getSimulatorContext();

  const result = await executeStateMachine(definition, variables, simulatorContext);

  expect(mockWait).toHaveBeenCalledWith(5, null, expect.any(Object));
  expect(result).toEqual({ someString: 'hello' });
});

test('executes a Succeed step', async () => {
  const definition = {
    StartAt: 'SucceedStep',
    States: {
      SucceedStep: {
        Type: 'Succeed',
      },
    },
  };

  const input = { someString: 'hello' };
  const variables = getVariables(definition, input);
  const simulatorContext = getSimulatorContext();

  const result = await executeStateMachine(definition, variables, simulatorContext);

  expect(result).toEqual({ someString: 'hello' });
});

test('executes a Fail step', async () => {
  const definition = {
    StartAt: 'FailStep',
    States: {
      FailStep: {
        Type: 'Fail',
        Error: 'Oh no!',
        Cause: 'Something went wrong',
      },
    },
  };

  const variables = getVariables(definition, {});
  const simulatorContext = getSimulatorContext();

  await expect(() => executeStateMachine(definition, variables, simulatorContext)).rejects.toThrowError(FailError);
});

test('executes a Parallel step', async () => {
  const definition = {
    StartAt: 'ParallelStep',
    States: {
      ParallelStep: {
        Type: 'Parallel',
        Branches: [
          {
            StartAt: 'BranchA',
            States: {
              BranchA: {
                Type: 'Pass',
                Parameters: {
                  branchA: true,
                },
                End: true,
              },
            },
          },
          {
            StartAt: 'BranchB',
            States: {
              BranchB: {
                Type: 'Pass',
                Parameters: {
                  branchB: true,
                },
                End: true,
              },
            },
          },
        ],
        End: true,
      },
    },
  };

  const variables = getVariables(definition, {});
  const simulatorContext = getSimulatorContext();

  const result = await executeStateMachine(definition, variables, simulatorContext);

  expect(result).toEqual([{ branchA: true }, { branchB: true }]);
});

test('executes a Map step', async () => {
  const definition = {
    StartAt: 'MapStep',
    States: {
      MapStep: {
        Type: 'Map',
        ItemProcessor: {
          StartAt: 'AddOne',
          States: {
            AddOne: {
              Type: 'Task',
              Resource: 'arn:aws:lambda:::function:adder',
              End: true,
            },
          },
        },
        End: true,
      },
    },
  };

  const mockAdder = vi.fn((input) => ({ number: input.number + 1 }));
  const resources = [
    {
      service: 'lambda',
      name: 'adder',
      function: mockAdder,
    },
  ];

  const input = [{ number: 1 }, { number: 2 }, { number: 3 }];
  const variables = getVariables(definition, input);
  const simulatorContext = getSimulatorContext({ resources });

  const result = await executeStateMachine(definition, variables, simulatorContext);

  expect(mockAdder).toHaveBeenCalledTimes(3);
  expect(result).toEqual([{ number: 2 }, { number: 3 }, { number: 4 }]);
});

describe('Error handling', () => {
  test('retries a failed task with backoff', async () => {
    const definition = {
      StartAt: 'TaskStep',
      States: {
        TaskStep: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:::function:my-function',
          Retry: [
            {
              ErrorEquals: [
                'States.SomeOtherError',
                'States.TaskFailed',
              ],
              MaxAttempts: 2,
              IntervalSeconds: 4,
              BackoffRate: 1.5,
            },
          ],
          End: true,
        },
      },
    };

    const mockLambda = vi.fn()
      .mockImplementationOnce(() => { throw new Error('Oh no!'); })
      .mockImplementationOnce(() => { throw new Error('Oh no!'); })
      .mockImplementationOnce(() => ({ someResult: 'success' }));

    const resources = [
      {
        service: 'lambda',
        name: 'my-function',
        function: mockLambda,
      },
    ];

    const input = { someKey: 'someValue' };
    const variables = getVariables(definition, input);
    const simulatorContext = getSimulatorContext({ resources });

    const result = await executeStateMachine(definition, variables, simulatorContext);

    expect(mockWait).toHaveBeenCalledWith(4, expect.any(Object));
    expect(mockWait).toHaveBeenCalledWith(6, expect.any(Object));
    expect(result).toEqual({ someResult: 'success' });
  });

  test('fails if the max attempts are exceeded', async () => {
    const definition = {
      StartAt: 'TaskStep',
      States: {
        TaskStep: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:::function:my-function',
          Retry: [
            {
              ErrorEquals: [
                'States.SomeOtherError',
                'States.TaskFailed',
              ],
              MaxAttempts: 2,
              IntervalSeconds: 4,
              BackoffRate: 1.5,
            },
          ],
          End: true,
        },
      },
    };

    const mockLambda = vi.fn().mockImplementation(() => { throw new Error('Oh no!'); });

    const resources = [
      {
        service: 'lambda',
        name: 'my-function',
        function: mockLambda,
      },
    ];

    const input = { someKey: 'someValue' };
    const variables = getVariables(definition, input);
    const simulatorContext = getSimulatorContext({ resources });

    await expect(() => executeStateMachine(definition, variables, simulatorContext)).rejects.toThrowError(TaskFailedError);

    expect(mockWait).toHaveBeenCalledTimes(2);
  });

  test('catches a matching error', async () => {
    const definition = {
      StartAt: 'TaskStep',
      States: {
        TaskStep: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:::function:my-function',
          Catch: [
            {
              ErrorEquals: [
                'States.SomeOtherError',
                'States.TaskFailed',
              ],
              ResultPath: '$.error',
              Next: 'CaughtStep',
            },
          ],
          End: true,
        },
        CaughtStep: {
          Type: 'Succeed',
        },
      },
    };

    const resources = [
      {
        service: 'lambda',
        name: 'my-function',
        function: () => {
          throw new Error('Oh no!');
        },
      },
    ];

    const input = { someKey: 'someValue' };
    const variables = getVariables(definition, input);
    const simulatorContext = getSimulatorContext({ resources });

    const result = await executeStateMachine(definition, variables, simulatorContext);

    expect(result).toEqual({
      someKey: 'someValue',
      error: {
        Error: 'States.TaskFailed',
        Cause: 'Error: Oh no!'
      },
    });
  });

  test('catches any error with a wildcard', async () => {
    const definition = {
      StartAt: 'TaskStep',
      States: {
        TaskStep: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:::function:my-function',
          Catch: [
            {
              ErrorEquals: [
                'States.SomeOtherError',
              ],
              Next: 'CaughtOtherStep',
            },
            {
              ErrorEquals: [
                'States.ALL',
              ],
              Next: 'CaughtStep',
            },
          ],
          End: true,
        },
        CaughtOtherStep: {
          Type: 'Fail',
        },
        CaughtStep: {
          Type: 'Succeed',
        },
      },
    };

    const resources = [
      {
        service: 'lambda',
        name: 'my-function',
        function: () => {
          throw new Error('Oh no!');
        },
      },
    ];

    const input = { someKey: 'someValue' };
    const variables = getVariables(definition, input);
    const simulatorContext = getSimulatorContext({ resources });

    const result = await executeStateMachine(definition, variables, simulatorContext);

    expect(result).toEqual({
      Error: 'States.TaskFailed',
      Cause: 'Error: Oh no!'
    });
  });

  test('throws again if no catchers match the error', async () => {
    const definition = {
      StartAt: 'TaskStep',
      States: {
        TaskStep: {
          Type: 'Task',
          Resource: 'arn:aws:lambda:::function:my-function',
          Catch: [
            {
              ErrorEquals: [
                'States.SomeOtherError',
              ],
              Next: 'CaughtStep',
            },
          ],
          End: true,
        },
        CaughtStep: {
          Type: 'Succeed',
        },
      },
    };

    const resources = [
      {
        service: 'lambda',
        name: 'my-function',
        function: () => {
          throw new Error('Oh no!');
        },
      },
    ];

    const input = { someKey: 'someValue' };
    const variables = getVariables(definition, input);
    const simulatorContext = getSimulatorContext({ resources });


    await expect(() => executeStateMachine(definition, variables, simulatorContext)).rejects.toThrowError(TaskFailedError);
  });
});
