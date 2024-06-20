import Hashes from 'jshashes';
import random from 'random';
import seedrandom from 'seedrandom';
import { v4 as uuidV4 } from 'uuid';
import { IntrinsicFailureError, SimulatorError } from './errors.js';
import { getValue } from './utils.js';

const applyFunction = (input, functionString) => {
  if (functionString.startsWith('States.Format(')) {
    return applyFormat(input, functionString);
  }

  if (functionString.startsWith('States.StringToJson(')) {
    return applyStringToJson(input, functionString);
  }

  if (functionString.startsWith('States.JsonToString(')) {
    return applyJsonToString(input, functionString);
  }

  if (functionString.startsWith('States.Array(')) {
    return applyArray(input, functionString);
  }

  if (functionString.startsWith('States.ArrayPartition(')) {
    return applyArrayPartition(input, functionString);
  }

  if (functionString.startsWith('States.ArrayContains(')) {
    return applyArrayContains(input, functionString);
  }

  if (functionString.startsWith('States.ArrayRange(')) {
    return applyArrayRange(input, functionString);
  }

  if (functionString.startsWith('States.ArrayGetItem(')) {
    return applyArrayGetItem(input, functionString);
  }

  if (functionString.startsWith('States.ArrayLength(')) {
    return applyArrayLength(input, functionString);
  }

  if (functionString.startsWith('States.ArrayUnique(')) {
    return applyArrayUnique(input, functionString);
  }

  if (functionString.startsWith('States.Base64Encode(')) {
    return applyBase64Encode(input, functionString);
  }

  if (functionString.startsWith('States.Base64Decode(')) {
    return applyBase64Decode(input, functionString);
  }

  if (functionString.startsWith('States.Hash(')) {
    return applyHash(input, functionString);
  }

  if (functionString.startsWith('States.JsonMerge(')) {
    return applyJsonMerge(input, functionString);
  }

  if (functionString.startsWith('States.MathRandom(')) {
    return applyMathRandom(input, functionString);
  }

  if (functionString.startsWith('States.MathAdd(')) {
    return applyMathAdd(input, functionString);
  }

  if (functionString.startsWith('States.StringSplit(')) {
    return applyStringSplit(input, functionString);
  }

  if (functionString.startsWith('States.UUID(')) {
    return applyUUID();
  }

  throw new IntrinsicFailureError(`Unrecognised intrinsic function [${functionString}]`);
};

const applyFormat = (input, functionString) => {
  let [resultString, ...values] = parseArgs('States.Format', functionString, input);

  while(resultString.includes('{}')) {
    resultString = resultString.replace('{}', values.shift());
  }

  return resultString;
};

const applyStringToJson = (input, functionString) => {
  const [string] = parseArgs('States.StringToJson', functionString, input);
  return JSON.parse(string);
};

const applyJsonToString = (input, functionString) => {
  const [object] = parseArgs('States.JsonToString', functionString, input);
  return JSON.stringify(object);
};

const applyArray = (input, functionString) => {
  return parseArgs('States.Array', functionString, input);
};

const applyArrayPartition = (input, functionString) => {
  let [array, chunkSize] = parseArgs('States.ArrayPartition', functionString, input);
  chunkSize = Number.parseInt(chunkSize);

  const chunks = [];

  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    chunks.push(chunk);
  }

  return chunks;
};

const applyArrayContains = (input, functionString) => {
  const [array, value] = parseArgs('States.ArrayContains', functionString, input);
  return array.includes(value);
};

const applyArrayRange = (input, functionString) => {
  let [start, end, step] = parseArgs('States.ArrayRange', functionString, input);
  start = Number.parseInt(start);
  end = Number.parseInt(end);
  step = Number.parseInt(step);

  const array = [start];

  while (array.at(-1) < end) {
    array.push(array.at(-1) + step);
  }

  return array;
};

const applyArrayGetItem = (input, functionString) => {
  let [array, index] = parseArgs('States.ArrayGetItem', functionString, input);
  index = Number.parseInt(index);
  return array[index];
};

const applyArrayLength = (input, functionString) => {
  let [array] = parseArgs('States.ArrayLength', functionString, input);
  return array.length;
};

const applyArrayUnique = (input, functionString) => {
  let [array] = parseArgs('States.ArrayUnique', functionString, input);
  return array.filter((value, idx) => array.indexOf(value) === idx);
};

const applyBase64Encode = (input, functionString) => {
  let [data] = parseArgs('States.Base64Encode', functionString, input);
  return btoa(data);
};

const applyBase64Decode = (input, functionString) => {
  let [data] = parseArgs('States.Base64Decode', functionString, input);
  return atob(data);
};

const applyHash = (input, functionString) => {
  let [data, algorithm] = parseArgs('States.Hash', functionString, input);

  switch (algorithm) {
    case 'MD5':
      return (new Hashes.MD5).hex(data);
    case 'SHA-1':
      return (new Hashes.SHA1).hex(data);
    case 'SHA-256':
      return (new Hashes.SHA256).hex(data);
    case 'SHA-384':
      throw new SimulatorError('States.Hash with SHA-384 not implemented');
    case 'SHA512':
      return (new Hashes.SHA512).hex(data);
    default:
      throw new IntrinsicFailureError(`States.Hash with ${algorithm} not supported`);
  }
};

const applyJsonMerge = (input, functionString) => {
  let [objectA, objectB, deepMerge] = parseArgs('States.JsonMerge', functionString, input);

  if (deepMerge !== false && deepMerge !== 'false') {
    throw new IntrinsicFailureError('States.JsonMerge only supports shallow merging');
  }

  return {
    ...objectA,
    ...objectB,
  };
};

const applyMathRandom = (input, functionString) => {
  let [min, max, seed] = parseArgs('States.MathRandom', functionString, input);
  min = Number.parseInt(min);
  max = Number.parseInt(max);

  if (seed) {
    random.use(seedrandom(seed));
  }

  return random.int(min, max);
};

const applyMathAdd = (input, functionString) => {
  let [numberA, numberB] = parseArgs('States.MathAdd', functionString, input);
  numberA = Number.parseInt(numberA);
  numberB = Number.parseInt(numberB);

  return numberA + numberB;
};

const applyStringSplit = (input, functionString) => {
  let [string, separator] = parseArgs('States.StringSplit', functionString, input);
  return string.split(separator);
};

const applyUUID = () => {
  return uuidV4();
};

const parseArgs = (functionName, functionString, input)  => {
  let argsString = functionString.replace(`${functionName}(`, '').slice(0, -1);

  argsString = argsString.replace(/\\'/g, 'ESCAPED_APOSTROPHE');

  let inString = false;
  let idx = 0;

  while (argsString[idx]) {
    if (argsString[idx] === `'`) {
      inString = !inString;
    }

    if (argsString[idx] === ',') {
      if (inString) {
        argsString = argsString.substring(0, idx) + 'ESCAPED_COMMA' + argsString.substring(idx + 1);
      }
    }

    idx++;
  }

  return argsString
    .split(',')
    .map((arg) => {
      arg = arg.trim();

      if (arg.startsWith('$')) {
        return getValue(input, arg);
      }

      return arg
        .replace(/'/g, '')
        .replace(/ESCAPED_APOSTROPHE/g, `\\'`)
        .replace(/ESCAPED_COMMA/g, ',')
    });
};

export {
  applyFunction,
};
