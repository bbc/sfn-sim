import { v4 as uuidV4 } from 'uuid';
import { TaskFailedError, SimulatorError } from './errors.js';

const runTask = async (state, simulatorContext, input) => {
  const { resources } = simulatorContext;

  if (state.Resource.startsWith('arn:aws:lambda:')) {
    const functionName = state.Resource.split(':')[6];
    return runLambdaTask(functionName, resources, input);
  }

  if (['arn:aws:states:::lambda:invoke', 'arn:aws:states:::aws-sdk:lambda:invoke'].includes(state.Resource)) {
    let functionName = input.FunctionName;
    if (functionName.startsWith('arn:')) {
      functionName = functionName.split(':')[6];
    }
    return runLambdaTask(functionName, resources, input.Payload);
  }

  if (state.Resource.startsWith('arn:aws:states:::aws-sdk:s3:')) {
    const action = state.Resource.split(':').pop();
    return runS3Task(action, resources, input);
  }

  if (state.Resource.startsWith('arn:aws:states:::sns:')) {
    const action = state.Resource.split(':').pop();
    return runSnsTask(action, resources, input);
  }

  if (state.Resource.startsWith('arn:aws:states:::sqs:')) {
    const action = state.Resource.split(':').pop();
    return runSqsTask(action, resources, input);
  }

  if (state.Resource.startsWith('arn:aws:states:::states:')) {
    const action = state.Resource.split(':')[6];
    return runStepFunctionsTask(action, resources, input);
  }

  throw new SimulatorError(`Unimplemented resource [${state.Resource}]`);
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
    throw new TaskFailedError(`S3 bucket [${Bucket}] not found`);
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

  throw new SimulatorError(`Unimplemented action [${action}] for service [s3]`);
};

const runSnsTask = (action, resources, input) => {
  const { TopicArn, Message } = input;
  const topicName = TopicArn.split(':').pop();

  const resource = resources.find(({ service, name }) => service === 'sns' && name === topicName);

  if (!resource) {
    throw new TaskFailedError(`SNS topic [${topicName}] not found`);
  }

  if (action === 'publish') {
    resource.messages.push(Message);
    return input;
  }

  throw new SimulatorError(`Unimplemented action [${action}] for service [sns]`);
};

const runSqsTask = (action, resources, input) => {
  const { QueueUrl, MessageBody } = input;
  const queueName = QueueUrl.split('/').pop();

  const resource = resources.find(({ service, name }) => service === 'sqs' && name === queueName);

  if (!resource) {
    throw new TaskFailedError(`SQS queue [${queueName}] not found`);
  }

  if (action === 'sendMessage') {
    resource.messages.push(MessageBody);
    return input;
  }

  throw new SimulatorError(`Unimplemented action [${action}] for service [sqs]`);
};

const runStepFunctionsTask = async (action, resources, input) => {
  const { StateMachineArn, Input } = input;
  const stateMachineName = StateMachineArn.split(':').pop();

  const resource = resources.find(({ service, name }) => service === 'stepFunctions' && name === stateMachineName);

  if (!resource) {
    throw new TaskFailedError(`State machine [${stateMachineName}] not found`);
  }

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

export default runTask;
