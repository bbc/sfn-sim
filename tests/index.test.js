import { vi, describe, test, expect, beforeEach } from 'vitest';
import { FailError, TaskFailedError, ValidationError } from '../src/errors.js';
import { load } from '../src/index.js';

const mockWait = vi.hoisted(() => vi.fn());

vi.mock('../src/utils.js', async () => ({
  ...(await vi.importActual('../src/utils.js')),
  wait: mockWait,
}));

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
  
    const stateMachine = load(definition);
    const result = await stateMachine.execute({ someString: 'hello' });
  
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
  
    const stateMachine = load(definition);
    const result = await stateMachine.execute({ someOtherString: 'goodbye' });
  
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

  const stateMachine = load(definition, resources);
  const result = await stateMachine.execute({ someNumber: 2 });

  expect(mockLambda).toHaveBeenCalledWith({ someNumber: 2 });
  expect(result).toEqual({ someNumber: 3 });
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

  const stateMachine = load(definition);

  await expect(() => stateMachine.execute({})).rejects.toThrowError(FailError);
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

  const stateMachine = load(definition);
  const result = await stateMachine.execute({ someString: 'hello' });

  expect(result).toEqual({ someString: 'hello' });
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

  const stateMachine = load(definition);
  const result = await stateMachine.execute({ shouldPass: true });

  expect(result).toEqual({ shouldPass: true });
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

  const stateMachine = load(definition);
  const result = await stateMachine.execute({});

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

  const stateMachine = load(definition, resources);
  const result = await stateMachine.execute([{ number: 1 }, { number: 2 }, { number: 3 }]);

  expect(mockAdder).toHaveBeenCalledTimes(3);
  expect(result).toEqual([{ number: 2 }, { number: 3 }, { number: 4 }]);
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

  const stateMachine = load(definition);
  const result = await stateMachine.execute({ someString: 'hello' });

  expect(mockWait).toHaveBeenCalledWith(5, expect.any(Object));
  expect(result).toEqual({ someString: 'hello' });
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

    const options = {
      simulateWait: false,
    };
  
    const stateMachine = load(definition, resources, options);
    const result = await stateMachine.execute({ someKey: 'someValue' });

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

    const options = {
      simulateWait: false,
    };
  
    const stateMachine = load(definition, resources, options);

    await expect(() => stateMachine.execute({ someKey: 'someValue' })).rejects.toThrowError(TaskFailedError);

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
  
    const stateMachine = load(definition, resources);
    const result = await stateMachine.execute({ someKey: 'someValue' });
  
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
  
    const stateMachine = load(definition, resources);
    const result = await stateMachine.execute({ someKey: 'someValue' });
  
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
  
    const stateMachine = load(definition, resources);

    await expect(() => stateMachine.execute({ someKey: 'someValue' })).rejects.toThrowError(TaskFailedError);
  });
});

test('throws a ValidationError for an invalid definition', () => {
  const invalidDefinition = {
    StartAt: 'NonexistentState',
    States: {},
  };

  expect(() => load(invalidDefinition)).toThrowError(ValidationError);
});
