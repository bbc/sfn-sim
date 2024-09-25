import { vi, test, expect, describe } from 'vitest';
import { TaskFailedError, SimulatorError } from '../src/errors.js';
import runTask from '../src/task.js';

describe('lambda', () => {
  describe('invoke (optimised integration)', () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:lambda:::function:my-function',
      End: true,
    };

    test('runs a function with a function ARN', async () => {
      const mockFunction = vi.fn((input) => ({ number: input.number + 1 }));

      const data = {
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

      const result = await runTask(state, data, input);

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

      const data = {
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

      const result = await runTask(stateWithAlias, data, input);

      expect(mockFunction).toHaveBeenCalledWith(input);
      expect(result).toEqual({
        number: 2,
      });
    });

    test('throws a States.TaskFailed error if the function is not found', async () => {
      const data = {
        resources: [
          {
            service: 'lambda',
            name: 'some-other-function',
            function: () => { },
          },
        ],
      };

      const expectedError = new TaskFailedError('Lambda function [my-function] not found');

      await expect(() => runTask(state, data, {})).rejects.toThrowError(expectedError);
    });

    test('throws a States.TaskFailed error if the function throws an error', async () => {
      const data = {
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

      await expect(() => runTask(state, data, {})).rejects.toThrowError(expectedError);
    });
  })
});

describe('s3', () => {
  describe('getObject', () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::aws-sdk:s3:getObject',
      End: true,
    };

    test('gets an object from a bucket', async () => {
      const data = {
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

      const result = await runTask(state, data, input);

      expect(result).toEqual({
        Body: 'someString',
      });
    });

    test('throws a State.TaskFailed error if the object is not found', async () => {
      const data = {
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

      await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
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
      const data = {
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

      await runTask(state, data, input);

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

    const data = {
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

    const expectedError = new TaskFailedError('S3 bucket [my-bucket] not found');

    await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
  });

  test('throws a SimulatorError error if the action is not supported', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::aws-sdk:s3:fillBucket',
      End: true,
    };

    const data = {
      resources: [
        {
          service: 's3',
          name: 'my-bucket',
          objects: [],
        },
      ],
    };

    const input = {
      Bucket: 'my-bucket',
    };

    const expectedError = new SimulatorError('Unimplemented action [fillBucket] for service [s3]');

    await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
  });
});

describe('sns', () => {
  describe('publish', () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::sns:publish',
      End: true,
    };

    test('publishes a message to a topic', async () => {
      const messages = [];
      const data = {
        resources: [
          {
            service: 'sns',
            name: 'my-topic',
            messages,
          },
        ],
      };

      const input = {
        TopicArn: 'arn:aws:sns:eu-west-1:012345678901:my-topic',
        Message: 'someString',
      };

      await runTask(state, data, input);

      expect(messages).toContain('someString');
    });
  });

  test('throws a State.TaskFailed error if the topic is not found', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::sns:publish',
      End: true,
    };

    const data = {
      resources: [
        {
          service: 'sns',
          name: 'some-other-topic',
          message: [],
        },
      ],
    };

    const input = {
      TopicArn: 'arn:aws:sns:eu-west-1:012345678901:my-topic',
      Message: 'someString',
    };

    const expectedError = new TaskFailedError('SNS topic [my-topic] not found');

    await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
  });

  test('throws a SimulatorError error if the action is not supported', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::sns:unpublish',
      End: true,
    };

    const data = {
      resources: [
        {
          service: 'sns',
          name: 'my-topic',
          message: [],
        },
      ],
    };

    const input = {
      TopicArn: 'arn:aws:sns:eu-west-1:012345678901:my-topic',
    };

    const expectedError = new SimulatorError('Unimplemented action [unpublish] for service [sns]');

    await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
  });
});

describe('sqs', () => {
  describe('sendMessage', () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::sqs:sendMessage',
      End: true,
    };

    test('sends a message to a queue', async () => {
      const messages = [];
      const data = {
        resources: [
          {
            service: 'sqs',
            name: 'my-queue',
            messages,
          },
        ],
      };

      const input = {
        QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/012345678901/my-queue',
        MessageBody: 'someString',
      };

      await runTask(state, data, input);

      expect(messages).toContain('someString');
    });
  });

  test('throws a State.TaskFailed error if the queue is not found', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::sqs:sendMessage',
      End: true,
    };

    const data = {
      resources: [
        {
          service: 'sqs',
          name: 'some-other-queue',
          message: [],
        },
      ],
    };

    const input = {
      QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/012345678901/my-queue',
      MessageBody: 'someString',
    };

    const expectedError = new TaskFailedError('SQS queue [my-queue] not found');

    await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
  });

  test('throws a SimulatorError error if the action is not supported', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::sqs:unsendMessage',
      End: true,
    };

    const data = {
      resources: [
        {
          service: 'sqs',
          name: 'my-queue',
          message: [],
        },
      ],
    };

    const input = {
      QueueUrl: 'https://sqs.eu-west-1.amazonaws.com/012345678901/my-queue',
    };

    const expectedError = new SimulatorError('Unimplemented action [unsendMessage] for service [sqs]');

    await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
  });
});

describe('stepFunctions', () => {
  describe('startExecution (optimised integration)', () => {
    describe('sync (wait for output)', () => {
      test('executes a state machine', async () => {
        const state = {
          Type: 'Task',
          Resource: 'arn:aws:states:::states:startExecution.sync:2',
          End: true,
        };
  
        const mockStateMachine = vi.fn((input) => ({ ...input, resultKey: 'resultValue' }));
        const data = {
          resources: [
            {
              service: 'stepFunctions',
              name: 'my-state-machine',
              stateMachine: mockStateMachine,
            },
          ],
        };
  
        const input = {
          StateMachineArn: 'arn:aws:states:::stateMachine:my-state-machine',
          Input: {
            someKey: 'someValue',
          },
        };
  
        const result = await runTask(state, data, input);
  
        expect(mockStateMachine).toHaveBeenCalledOnce();
        expect(result).toEqual(expect.objectContaining({
          Output: {
            someKey: 'someValue',
            resultKey: 'resultValue',
          },
          Status: 'SUCCEEDED',
        }));
      });

      test('throws a States.TaskFailed error if the state machine fails', async () => {
        const state = {
          Type: 'Task',
          Resource: 'arn:aws:states:::states:startExecution.sync:2',
          End: true,
        };

        const mockStateMachine = vi.fn(() => {
          throw new Error('oh no!');
        });
        const data = {
          resources: [
            {
              service: 'stepFunctions',
              name: 'my-state-machine',
              stateMachine: mockStateMachine,
            },
          ],
        };

        const input = {
          StateMachineArn: 'arn:aws:states:::stateMachine:my-state-machine',
          Input: { someKey: 'someValue' },
        };

        await expect(() => runTask(state, data, input)).rejects.toThrowError(TaskFailedError);
      });
    });

    describe('async (call and continue)', () => {
      test('starts execution of a state machine', async () => {
        const state = {
          Type: 'Task',
          Resource: 'arn:aws:states:::states:startExecution',
          End: true,
        };
  
        const mockStateMachine = vi.fn();
        const data = {
          resources: [
            {
              service: 'stepFunctions',
              name: 'my-state-machine',
              stateMachine: mockStateMachine,
            },
          ],
        };
  
        const input = {
          StateMachineArn: 'arn:aws:states:::stateMachine:my-state-machine',
          Input: { someKey: 'someValue' },
        };
  
        const result = await runTask(state, data, input);
  
        expect(mockStateMachine).toHaveBeenCalledOnce();
        expect(result).toEqual(expect.objectContaining({
          SdkHttpMetadata: expect.objectContaining({
            HttpStatusCode: 200,
          }),
        }));
        expect(result.Output).toBeUndefined();
      });

      test('handles a state machine failing', async () => {
        vi.spyOn(console, 'debug').mockImplementation(() => {});

        const state = {
          Type: 'Task',
          Resource: 'arn:aws:states:::states:startExecution',
          End: true,
        };

        const mockStateMachine = vi.fn(() => {
          throw new Error('oh no!');
        });
        const data = {
          resources: [
            {
              service: 'stepFunctions',
              name: 'my-state-machine',
              stateMachine: mockStateMachine,
            },
          ],
        };

        const input = {
          StateMachineArn: 'arn:aws:states:::stateMachine:my-state-machine',
          Input: { someKey: 'someValue' },
        };
  
        const result = await runTask(state, data, input);
  
        expect(mockStateMachine).toHaveBeenCalledOnce();
        expect(result.SdkHttpMetadata.HttpStatusCode).toBe(200);
      });
    });
  });

  test('throws a State.TaskFailed error if the state machine is not found', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::states:startExecution.sync:2',
      End: true,
    };

    const data = {
      resources: [
        {
          service: 'stepFunctions',
          name: 'some-other-state-machine',
          stateMachine: vi.fn(),
        },
      ],
    };

    const input = {
      StateMachineArn: 'arn:aws:states:::stateMachine:my-state-machine',
      Input: { someKey: 'someValue' },
    };

    const expectedError = new TaskFailedError('State machine [my-state-machine] not found');

    await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
  });

  test('throws a SimulatorError error if the action is not supported', async () => {
    const state = {
      Type: 'Task',
      Resource: 'arn:aws:states:::states:stopExecution',
      End: true,
    };

    const data = {
      resources: [
        {
          service: 'stepFunctions',
          name: 'my-state-machine',
          stateMachine: vi.fn(),
        },
      ],
    };

    const input = {
      StateMachineArn: 'arn:aws:states:::stateMachine:my-state-machine',
      Input: { someKey: 'someValue' },
    };

    const expectedError = new SimulatorError('Unimplemented action [stopExecution] for service [stepFunctions]');

    await expect(() => runTask(state, data, input)).rejects.toThrowError(expectedError);
  });
});

test('throws a SimulatorError error if an unimplemented resource is specified', async () => {
  const state = {
    Type: 'Task',
    Resource: 'arn:aws:bananas:::banana:🍌',
    End: true,
  };

  const data = {
    resources: [],
  };

  const expectedError = new SimulatorError('Unimplemented resource [arn:aws:bananas:::banana:🍌]');

  await expect(() => runTask(state, data, {})).rejects.toThrowError(expectedError);
});
