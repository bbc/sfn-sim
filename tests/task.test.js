import { vi, test, expect, describe } from 'vitest';
import { TaskFailedError } from '../src/errors.js';
import runTask from '../src/task.js';

describe('lambda', () => {
  const state = {
    Type: 'Task',
    Resource: 'arn:aws:lambda:::function:my-function',
    End: true,
  };

  test('runs a function with a function ARN', async () => {
    const mockFunction = vi.fn((input) => ({ number: input.number + 1 }));

    const context = {
      resources: [
        {
          service: 'lambda',
          name: 'my-function',
          function: mockFunction,
        },
      ],
    };

    const input = {
      number: 1,
    };

    const result = await runTask(state, context, input);

    expect(mockFunction).toHaveBeenCalledWith(input);
    expect(result).toEqual({
      number: 2,
    });
  });

  test('runs a function with an alias ARN', async () => {
    const stateWithAlias = {
      ...state,
      Resource: 'arn:aws:lambda:::function:my-function:some-alias',
    };

    const mockFunction = vi.fn((input) => ({ number: input.number + 1 }));

    const context = {
      resources: [
        {
          service: 'lambda',
          name: 'my-function',
          function: mockFunction,
        },
      ],
    };

    const input = {
      number: 1,
    };

    const result = await runTask(stateWithAlias, context, input);

    expect(mockFunction).toHaveBeenCalledWith(input);
    expect(result).toEqual({
      number: 2,
    });
  });

  test('throws a States.TaskFailed error if the function is not found', async () => {
    const context = {
      resources: [
        {
          service: 'lambda',
          name: 'some-other-function',
          function: () => { },
        },
      ],
    };

    const expectedError = new TaskFailedError('Lambda function [my-function] not found');

    await expect(() => runTask(state, context, {})).rejects.toThrowError(expectedError);
  });

  test('throws a States.TaskFailed error if the function throws an error', async () => {
    const context = {
      resources: [
        {
          service: 'lambda',
          name: 'my-function',
          function: () => {
            throw new Error('Lambda runtime error');
          },
        },
      ],
    };

    const expectedError = new TaskFailedError('Error: Lambda runtime error');

    await expect(() => runTask(state, context, {})).rejects.toThrowError(expectedError);
  });
});

describe('s3', () => {
  describe('getObject', () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::aws-sdk:s3:getObject',
      End: true,
    };

    test('gets an object from a bucket', async () => {
      const context = {
        resources: [
          {
            service: 's3',
            name: 'my-bucket',
            objects: [
              {
                key: 'my-object',
                body: 'someString',
              },
            ],
          },
        ],
      };

      const input = {
        Bucket: 'my-bucket',
        Key: 'my-object',
      };

      const result = await runTask(state, context, input);

      expect(result).toEqual({
        Body: 'someString',
      });
    });

    test('throws a State.TaskFailed error if the object is not found', async () => {
      const context = {
        resources: [
          {
            service: 's3',
            name: 'my-bucket',
            objects: [
              {
                key: 'some-other-object',
                body: 'someString',
              },
            ],
          },
        ],
      };

      const input = {
        Bucket: 'my-bucket',
        Key: 'my-object',
      };

      const expectedError = new TaskFailedError('No object in bucket [my-bucket] with key [my-object]');

      await expect(() => runTask(state, context, input)).rejects.toThrowError(expectedError);
    });
  });

  describe('putObject', () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::aws-sdk:s3:putObject',
      End: true,
    };

    test('puts an object in a bucket', async () => {
      const objects = [];
      const context = {
        resources: [
          {
            service: 's3',
            name: 'my-bucket',
            objects,
          },
        ],
      };

      const input = {
        Bucket: 'my-bucket',
        Key: 'my-object',
        Body: 'someString',
      };

      await runTask(state, context, input);

      expect(objects).toContainEqual({
        key: 'my-object',
        body: 'someString',
      });
    });
  });

  test('throws a State.TaskFailed error if the bucket is not found', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::aws-sdk:s3:getObject',
      End: true,
    };

    const context = {
      resources: [
        {
          service: 's3',
          name: 'some-other-bucket',
          objects: [],
        },
      ],
    };

    const input = {
      Bucket: 'my-bucket',
      Key: 'my-object',
    };

    const expectedError = new TaskFailedError('Bucket [my-bucket] not found');

    await expect(() => runTask(state, context, input)).rejects.toThrowError(expectedError);
  });
});

test('throws a States.TaskFailed error if an unsupported resource is specified', async () => {
  const state = {
    Type: 'Task',
    Resource: 'arn:aws:bananas:::banana:🍌',
    End: true,
  };

  const context = {
    resources: [],
  };

  const expectedError = new TaskFailedError('Unsupported resource [arn:aws:bananas:::banana:🍌]');

  await expect(() => runTask(state, context, {})).rejects.toThrowError(expectedError);
});
