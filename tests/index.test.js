import { vi, describe, test, expect } from 'vitest';
import { FailError, ValidationError } from '../src/errors.js';
import { load } from '../src/index.js';

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
        Seconds: 1,
        End: true,
      },
    },
  };

  const stateMachine = load(definition);
  const result = await stateMachine.execute({ someString: 'hello' });

  expect(result).toEqual({ someString: 'hello' });
});

test('throws a ValidationError for an invalid definition', () => {
  const invalidDefinition = {
    StartAt: 'NonexistentState',
    States: {},
  };

  expect(() => load(invalidDefinition)).toThrowError(ValidationError);
});
