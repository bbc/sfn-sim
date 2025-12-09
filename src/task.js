import { v4 as uuidV4 } from 'uuid';
import { TaskFailedError, SimulatorError } from './errors.js';

const runTask = async (state, resource, input, queryLanguage) => {
  if (state.Resource.startsWith('arn:aws:lambda:')) {
    return runLambdaTask(resource, input, queryLanguage);
  }

  if (['arn:aws:states:::lambda:invoke', 'arn:aws:states:::aws-sdk:lambda:invoke'].includes(state.Resource)) {
    return runLambdaTask(resource, input.Payload, queryLanguage);
  }

  if (state.Resource.startsWith('arn:aws:states:::aws-sdk:s3:')) {
    const action = state.Resource.split(':').pop();
    return runS3Task(action, resource, input);
  }

  if (state.Resource.startsWith('arn:aws:states:::sns:')) {
    const action = state.Resource.split(':').pop();
    return runSnsTask(action, resource, input);
  }

  if (state.Resource.startsWith('arn:aws:states:::sqs:')) {
    const action = state.Resource.split(':').pop();
    return runSqsTask(action, resource, input);
  }

  if (state.Resource.startsWith('arn:aws:states:::states:')) {
    const action = state.Resource.split(':')[6];
    return runStepFunctionsTask(action, resource, input);
  }

  throw new SimulatorError(`Unimplemented resource [${state.Resource}]`);
};

const getResource = (state, simulatorContext, input) => {
  const { resources } = simulatorContext;

  if (state.Resource.startsWith('arn:aws:lambda:')) {
    const functionName = state.Resource.split(':')[6];
    const resource = resources.find(({ service, name }) => service === 'lambda' && name === functionName);

    if (!resource) {
      throw new TaskFailedError(`Lambda function [${functionName}] not found`);
    }

    return resource;
  }

  if (['arn:aws:states:::lambda:invoke', 'arn:aws:states:::aws-sdk:lambda:invoke'].includes(state.Resource)) {
    let functionName = input.FunctionName;
    if (functionName.startsWith('arn:')) {
      functionName = functionName.split(':')[6];
    }
    const resource = resources.find(({ service, name }) => service === 'lambda' && name === functionName);

    if (!resource) {
      throw new TaskFailedError(`Lambda function [${functionName}] not found`);
    }

    return resource;
  }

  if (state.Resource.startsWith('arn:aws:states:::aws-sdk:s3:')) {
    const { Bucket } = input;
    const resource = resources.find(({ service, name }) => service === 's3' && name === Bucket);

    if (!resource) {
      throw new TaskFailedError(`S3 bucket [${Bucket}] not found`);
    }

    return resource;
  }

  if (state.Resource.startsWith('arn:aws:states:::sns:')) {
    const { TopicArn } = input;
    const topicName = TopicArn.split(':').pop();
    const resource = resources.find(({ service, name }) => service === 'sns' && name === topicName);

    if (!resource) {
      throw new TaskFailedError(`SNS topic [${topicName}] not found`);
    }

    return resource;
  }

  if (state.Resource.startsWith('arn:aws:states:::sqs:')) {
    const { QueueUrl } = input;
    const queueName = QueueUrl.split('/').pop();
    const resource = resources.find(({ service, name }) => service === 'sqs' && name === queueName);

    if (!resource) {
      throw new TaskFailedError(`SQS queue [${queueName}] not found`);
    }

    return resource;
  }

  if (state.Resource.startsWith('arn:aws:states:::states:')) {
    const { StateMachineArn } = input;
    const stateMachineName = StateMachineArn.split(':').pop();
    const resource = resources.find(({ service, name }) => service === 'stepFunctions' && name === stateMachineName);

    if (!resource) {
      throw new TaskFailedError(`State machine [${stateMachineName}] not found`);
    }

    return resource;
  }

  throw new SimulatorError(`Unimplemented resource [${state.Resource}]`);
};

const runLambdaTask = async (resource, input, queryLanguage) => {
  try {
    const Payload = await resource.function(input);
    return queryLanguage === 'JSONata' ? { Payload } : Payload;
  } catch (error) {
    if (error.name === 'Error') {
      throw new TaskFailedError(error);
    } else {
      throw error;
    }
  }
};

const runS3Task = (action, resource, input) => {
  const { Bucket, Key, Body } = input;

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

  throw new SimulatorError(`Unimplemented action [${action}] for service [s3]`);
};

const runSnsTask = (action, resource, input) => {
  const { Message } = input;

  if (action === 'publish') {
    resource.messages.push(Message);
    return input;
  }

  throw new SimulatorError(`Unimplemented action [${action}] for service [sns]`);
};

const runSqsTask = (action, resource, input) => {
  const { MessageBody } = input;

  if (action === 'sendMessage') {
    resource.messages.push(MessageBody);
    return input;
  }

  throw new SimulatorError(`Unimplemented action [${action}] for service [sqs]`);
};

const runStepFunctionsTask = async (action, resource, input) => {
  const { StateMachineArn, Input } = input;
  const stateMachineName = resource.name;

  if (action === 'startExecution.sync') {
    const executionId = uuidV4();
    const StartDate = Date.now();
    let Output;

    try {
      Output = await resource.stateMachine(Input);
    } catch (error) {
      throw new TaskFailedError(error);
    }

    const StopDate = Date.now();

    return {
      ExecutionArn: `arn:aws:states:::execution:${stateMachineName}:${executionId}`,
      Input,
      InputDetails: {
        Included: true,
      },
      Name: executionId,
      Output,
      OutputDetails: {
        Included: true,
      },
      RedriveCount: 0,
      RedriveStatus: 'NOT_REDRIVABLE',
      RedriveStatusReason: 'Execution is SUCCEEDED and cannot be redriven',
      StartDate,
      StateMachineArn,
      Status: 'SUCCEEDED',
      StopDate,
    };
  }

  if (action === 'startExecution') {
    const executionId = uuidV4();
    const StartDate = Date.now();

    try {
      resource.stateMachine(Input);
    } catch (error) {
      console.debug(error);
    }

    return {
      ExecutionArn: `arn:aws:states:::execution:${stateMachineName}:${executionId}`,
      SdkHttpMetadata: {
        HttpStatusCode: 200,
      },
      StartDate,
    };
  }

  throw new SimulatorError(`Unimplemented action [${action}] for service [stepFunctions]`);
};

const runTaskWithWaitForTaskToken = async (state, simulatorContext, input, queryLanguage = 'JSONPath') => {
  const suffix = '.waitForTaskToken';
  let stateResource = state.Resource;
  let hasWaitForTaskToken = false;

  if (stateResource.endsWith(suffix)) {
    stateResource = stateResource.slice(0, -suffix.length);
    hasWaitForTaskToken = true;
  }

  const taskState = {
    ...state,
    Resource: stateResource,
  };

  const resource = getResource(taskState, simulatorContext, input);

  if (hasWaitForTaskToken) {
    const taskOutput = await runTask(taskState, resource, input, queryLanguage);

    if (!resource.taskCallback) {
      throw new SimulatorError(`No taskCallback provided for [${resource.service}] resource [${resource.name}]`);
    }

    try {
      const stepOutput = await resource.taskCallback(input, taskOutput);
      return stepOutput;
    } catch (error) {
      throw new TaskFailedError(error);
    }
  } else {
    return runTask(state, resource, input, queryLanguage);
  }
};

export default runTaskWithWaitForTaskToken;
