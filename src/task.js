const runTask = async (state, context, input) => {
  const { resources } = context;

  if (state.Resource.startsWith('arn:aws:states:::lambda:')) {
    const functionName = state.Resource.replace('arn:aws:states:::lambda:', '').split(':')[0];
    return runLambdaTask(functionName, resources, input);
  }

  if (state.Resource.startsWith('arn:aws:states:::aws-sdk:s3:')) {
    const action = state.Resource.split(':').pop();
    return runS3Task(action, resources, input);
  }

  throw new Error(`unsupported resource [${state.Resource}]`);
};

const runLambdaTask = async (functionName, resources, input) => {
  const resource = resources.find(({ service, name }) => service === 'lambda' && name === functionName);

  if (!resource) {
    throw new Error(`lambda resource [${functionName}] not found`);
  }

  return resource.function(input);
};

const runS3Task = (action, resources, input) => {
  const { Bucket, Key, Body } = input;

  const resource = resources.find(({ service, name }) => service === 's3' && name === Bucket);

  if (action === 'getObject') {
    return {
      Body: resource.objects.find((object) => object.key === Key)?.body,
    };
  }

  if (action === 'putObject') {
    resource.objects.push({
      key: Key,
      body: JSON.stringify(Body),
    });
    return input;
  }
};

export default runTask;
