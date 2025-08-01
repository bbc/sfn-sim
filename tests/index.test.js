import { vi, describe, test, expect, beforeEach } from 'vitest';
import { ValidationError } from '../src/errors.js';
import { load } from '../src/index.js';

const mockExecuteStateMachine = vi.hoisted(() => vi.fn());

vi.mock('../src/executors.js', async () => ({
  executeStateMachine: mockExecuteStateMachine,
}));

const definition = {
  StartAt: 'SucceedStep',
  States: {
    SucceedStep: {
      Type: 'Succeed',
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('execution', () => {
  test('loads and returns a state machine that can be executed', async () => {
    mockExecuteStateMachine.mockResolvedValueOnce({ someOutput: 'goodbye' });

    const stateMachine = load(definition);
    const result = await stateMachine.execute({ someString: 'hello' });

    expect(mockExecuteStateMachine).toHaveBeenCalledWith(
      definition,
      expect.objectContaining({
        states: expect.objectContaining({
          input: { someString: 'hello' },
          context: expect.objectContaining({
            Execution: expect.objectContaining({
              Input: { someString: 'hello' },
            }),
          }),
        }),
      }),
      {
        resources: expect.any(Array),
        options: expect.any(Object),
        queryLanguage: expect.any(String),
      },
    );
    expect(result).toEqual({ someOutput: 'goodbye' });
  });

  test('state machine and execution names can be set', async () => {
    mockExecuteStateMachine.mockResolvedValueOnce((input) => input);

    const stateMachine = load(
      definition,
      [],
      {
        stateMachineName: 'test-state-machine',
        executionName: 'test-execution',
      },
    );
    await stateMachine.execute({ someString: 'hello' });

    expect(mockExecuteStateMachine).toHaveBeenCalledWith(
      definition,
      expect.objectContaining({
        states: expect.objectContaining({
          context: expect.objectContaining({
            Execution: expect.objectContaining({
              Name: 'test-execution',
            }),
            StateMachine: expect.objectContaining({
              Name: 'test-state-machine',
            }),
          }),
        }),
      }),
      expect.any(Object),
    );
  });

  test('query language defaults to JSONPath', async () => {
    mockExecuteStateMachine.mockResolvedValueOnce((input) => input);

    const stateMachine = load(definition);
    await stateMachine.execute({ someString: 'hello' });

    expect(mockExecuteStateMachine).toHaveBeenCalledWith(
      definition,
      expect.any(Object),
      expect.objectContaining({
        queryLanguage: 'JSONPath',
      }),
    );
  });

  test('query language can be set to JSONata', async () => {
    mockExecuteStateMachine.mockResolvedValueOnce((input) => input);

    const jsonataDefinition = {
      ...definition,
      QueryLanguage: 'JSONata',
    };

    const stateMachine = load(jsonataDefinition, [], { validateDefinition: false });
    await stateMachine.execute({ someString: 'hello' });

    expect(mockExecuteStateMachine).toHaveBeenCalledWith(
      jsonataDefinition,
      expect.any(Object),
      expect.objectContaining({
        queryLanguage: 'JSONata',
      }),
    );
  });
});

describe('execution', () => {
  test('throws a ValidationError for an invalid definition', () => {
    const invalidDefinition = {
      StartAt: 'NonexistentState',
      States: {},
    };

    expect(() => load(invalidDefinition)).toThrowError(ValidationError);
  });

  test('definition validation can be disabled', async () => {
    const invalidDefinition = {
      StartAt: 'NonexistentState',
      States: {},
    };

    const stateMachine = load(invalidDefinition, [], { validateDefinition: false });
    await stateMachine.execute();
  });
});
