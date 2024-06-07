import { TaskFailedError } from './errors.js';

const runTask = async (state, context, input) => {
  const { resources } = context;

  if (state.Resource.startsWith('arn:aws:lambda:')) {
    const functionName = state.Resource.split(':')[6];
    return runLambdaTask(functionName, resources, input);
  }

  if (state.Resource.startsWith('arn:aws:states:::aws-sdk:s3:')) {
    const action = state.Resource.split(':').pop();
    return runS3Task(action, resources, input);
  }

  throw new TaskFailedError(`Unsupported resource [${state.Resource}]`);
};

const runLambdaTask = async (functionName, resources, input) => {
  const resource = resources.find(({ service, name }) => service === 'lambda' && name === functionName);

  if (!resource) {
    throw new TaskFailedError(`Lambda function [${functionName}] not found`);
  }

  try {
    return resource.function(input);
  } catch (error) {
    throw new TaskFailedError(error);
  }
};

const runS3Task = (action, resources, input) => {
  const { Bucket, Key, Body } = input;

  const resource = resources.find(({ service, name }) => service === 's3' && name === Bucket);

  if (!resource) {
    throw new TaskFailedError(`Bucket [${Bucket}] not found`);
  }

  if (action === 'getObject') {
    const object = resource.objects.find((object) => object.key === Key);

    if (!object) {
      throw new TaskFailedError(`No object in bucket [${Bucket}] with key [${Key}]`);
    }

    return {
      Body: object.body,
    };
  }

  if (action === 'putObject') {
    resource.objects.push({
      key: Key,
      body: Body,
    });
    return input;
  }
};

export default runTask;
