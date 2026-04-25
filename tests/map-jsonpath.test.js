import { describe, test, expect } from "vitest";
import { v4 as uuidV4 } from "uuid";
import { executeStateMachine } from "../src/executors.js";
import { load } from "../src/index.js";
import { defaultOptions } from "../src/options.js";

const getVariables = (definition, input) => ({
  states: {
    input,
    context: {
      Execution: {
        Id: uuidV4(),
        Input: input,
        Name: "test-execution",
        StartTime: new Date().toISOString(),
      },
      State: {
        Name: definition.StartAt,
      },
      StateMachine: {
        Id: uuidV4(),
        Name: "test-state-machine",
      },
      Task: {},
    },
  },
});

const getSimulatorContext = (overrides = {}) => ({
  resources: [],
  options: defaultOptions,
  queryLanguage: "JSONPath",
  ...overrides,
});

describe("Map state (JSONPath)", () => {
  describe("Execution and context", () => {
    test("reads items using ItemReader before running item processor", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
              },
              Parameters: {
                Bucket: "source-bucket",
                Key: "items.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ProjectItem",
              States: {
                ProjectItem: {
                  Type: "Pass",
                  Parameters: {
                    "id.$": "$$.Map.Item.Value.id",
                  },
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            {
              key: "items.json",
              body: JSON.stringify([{ id: "a" }, { id: "b" }]),
            },
          ],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, { requestId: "r1" }),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([{ id: "a" }, { id: "b" }]);
    });

    test("keeps parent Execution context for INLINE map iterations", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "Map Step",
        States: {
          "Map Step": {
            Type: "Map",
            ItemsPath: "$",
            ItemProcessor: {
              StartAt: "InspectExecutionInput",
              States: {
                InspectExecutionInput: {
                  Type: "Pass",
                  Parameters: {
                    "item.$": "$",
                    "executionInput.$": "$$.Execution.Input",
                  },
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const result = await executeStateMachine(
        definition,
        getVariables(definition, [1, 2, 3]),
        getSimulatorContext()
      );

      expect(result).toEqual([
        { item: 1, executionInput: [1, 2, 3] },
        { item: 2, executionInput: [1, 2, 3] },
        { item: 3, executionInput: [1, 2, 3] },
      ]);
    });

    test("creates per-item Execution context for DISTRIBUTED map iterations", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "My Map Step",
        States: {
          "My Map Step": {
            Type: "Map",
            Label: "Custom Label Name",
            ItemsPath: "$",
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "InspectDistributedExecution",
              States: {
                InspectDistributedExecution: {
                  Type: "Pass",
                  Parameters: {
                    "item.$": "$",
                    "executionInput.$": "$$.Execution.Input",
                    "executionId.$": "$$.Execution.Id",
                    "executionName.$": "$$.Execution.Name",
                    "executionStartTime.$": "$$.Execution.StartTime",
                  },
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const result = await executeStateMachine(
        definition,
        getVariables(definition, [1, 2, 3]),
        getSimulatorContext()
      );

      expect(result).toEqual([
        expect.objectContaining({
          item: 1,
          executionInput: 1,
          executionName: expect.stringMatching(
            /^test-execution\/CustomLabelName:[0-9a-f-]{36}$/
          ),
        }),
        expect.objectContaining({
          item: 2,
          executionInput: 2,
          executionName: expect.stringMatching(
            /^test-execution\/CustomLabelName:[0-9a-f-]{36}$/
          ),
        }),
        expect.objectContaining({
          item: 3,
          executionInput: 3,
          executionName: expect.stringMatching(
            /^test-execution\/CustomLabelName:[0-9a-f-]{36}$/
          ),
        }),
      ]);

      for (const entry of result) {
        expect(entry.executionId).toEqual(expect.any(String));
        expect(entry.executionStartTime).toEqual(expect.any(String));
      }

      const uniqueIds = new Set(result.map((entry) => entry.executionId));
      expect(uniqueIds.size).toBe(3);
    });
  });

  describe("ItemReader", () => {
    test("resolves ItemReader Parameters Bucket and Key from state input", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
              },
              Parameters: {
                "Bucket.$": "$.reader.bucket",
                "Key.$": "$.reader.key",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ProjectItem",
              States: {
                ProjectItem: {
                  Type: "Pass",
                  Parameters: {
                    "id.$": "$$.Map.Item.Value.id",
                  },
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "dynamic-source-bucket",
          objects: [
            {
              key: "dynamic/items.json",
              body: JSON.stringify([{ id: "dyn-a" }, { id: "dyn-b" }]),
            },
          ],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, {
          reader: {
            bucket: "dynamic-source-bucket",
            key: "dynamic/items.json",
          },
        }),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([{ id: "dyn-a" }, { id: "dyn-b" }]);
    });

    test("reads nested items using ItemReader ReaderConfig.ItemsPointer", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
                ItemsPointer: "/payload/records",
              },
              Parameters: {
                Bucket: "source-bucket",
                Key: "nested.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ProjectItem",
              States: {
                ProjectItem: {
                  Type: "Pass",
                  Parameters: {
                    "id.$": "$$.Map.Item.Value.id",
                  },
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            {
              key: "nested.json",
              body: JSON.stringify({
                payload: {
                  records: [{ id: "nested-a" }, { id: "nested-b" }],
                },
              }),
            },
          ],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, { requestId: "r2" }),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([{ id: "nested-a" }, { id: "nested-b" }]);
    });

    test("limits item count using ItemReader ReaderConfig.MaxItems", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
                MaxItems: 2,
              },
              Parameters: {
                Bucket: "source-bucket",
                Key: "many-items.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ProjectItem",
              States: {
                ProjectItem: {
                  Type: "Pass",
                  Parameters: {
                    "id.$": "$$.Map.Item.Value.id",
                  },
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            {
              key: "many-items.json",
              body: JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]),
            },
          ],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, { requestId: "r3" }),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([{ id: "a" }, { id: "b" }]);
    });

    test("limits item count using ItemReader ReaderConfig.MaxItemsPath from state input", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
                MaxItemsPath: "$.limit",
              },
              Parameters: {
                Bucket: "source-bucket",
                Key: "many-items.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ProjectItem",
              States: {
                ProjectItem: {
                  Type: "Pass",
                  Parameters: {
                    "id.$": "$$.Map.Item.Value.id",
                  },
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            {
              key: "many-items.json",
              body: JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]),
            },
          ],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, { limit: 3 }),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    });

    test("fails with States.ItemReaderFailed when both MaxItems and MaxItemsPath are set", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
                MaxItems: 2,
                MaxItemsPath: "$.limit",
              },
              Parameters: {
                Bucket: "source-bucket",
                Key: "many-items.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ProjectItem",
              States: {
                ProjectItem: { Type: "Pass", End: true },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            {
              key: "many-items.json",
              body: JSON.stringify([{ id: "a" }, { id: "b" }, { id: "c" }]),
            },
          ],
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, { limit: 1 }),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({ name: "States.ItemReaderFailed" });
    });

    test("reads a list of S3 objects from a prefix using ItemReader listObjectsV2", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Parameters: {
                Bucket: "source-bucket",
                Prefix: "logs/2024/",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            { key: "logs/2024/a.json", body: '{"a":1}' },
            { key: "logs/2024/b.json", body: '{"b":2}' },
            { key: "logs/2023/c.json", body: '{"c":3}' },
            { key: "images/pic.jpg", body: "binary-bytes" },
          ],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, { runId: "prefix-read" }),
        getSimulatorContext({ resources })
      );

      expect(result).toHaveLength(2);
      expect(result).toEqual([
        expect.objectContaining({
          Key: "logs/2024/a.json",
          ETag: expect.any(String),
          StorageClass: "STANDARD",
        }),
        expect.objectContaining({
          Key: "logs/2024/b.json",
          ETag: expect.any(String),
          StorageClass: "STANDARD",
        }),
      ]);
      expect(result[0].Size).toEqual(expect.any(Number));
      expect(result[1].Size).toEqual(expect.any(Number));
      expect(result[0].LastModified).toEqual(expect.any(String));
      expect(result[1].LastModified).toEqual(expect.any(String));
    });

    test("resolves ItemReader Parameters Bucket and Prefix from state input for listObjectsV2", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Parameters: {
                "Bucket.$": "$.reader.bucket",
                "Prefix.$": "$.reader.prefix",
              },
            },
            ItemSelector: {
              "key.$": "$$.Map.Item.Value.Key",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "dynamic-source-bucket",
          objects: [
            { key: "logs/2025/a.json", body: '{"a":1}' },
            { key: "logs/2025/b.json", body: '{"b":2}' },
            { key: "logs/2024/c.json", body: '{"c":3}' },
          ],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, {
          reader: {
            bucket: "dynamic-source-bucket",
            prefix: "logs/2025/",
          },
        }),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([
        { key: "logs/2025/a.json" },
        { key: "logs/2025/b.json" },
      ]);
    });

    test("applies ItemSelector to listObjectsV2 metadata items", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Parameters: {
                Bucket: "source-bucket",
                Prefix: "logs/2024/",
              },
            },
            ItemSelector: {
              "key.$": "$$.Map.Item.Value.Key",
              "bytes.$": "$$.Map.Item.Value.Size",
              "class.$": "$$.Map.Item.Value.StorageClass",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            { key: "logs/2024/a.json", body: '{"a":1}' },
            { key: "logs/2024/b.json", body: '{"b":2}' },
            { key: "logs/2023/c.json", body: '{"c":3}' },
          ],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, { runId: "selector-read" }),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([
        {
          key: "logs/2024/a.json",
          bytes: expect.any(Number),
          class: "STANDARD",
        },
        {
          key: "logs/2024/b.json",
          bytes: expect.any(Number),
          class: "STANDARD",
        },
      ]);
    });

    test("passes object item input type to child executions from ItemReader output", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Parameters: {
                Bucket: "source-bucket",
                Prefix: "logs/2024/",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "InspectType",
              States: {
                InspectType: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:inspect-type",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            { key: "logs/2024/a.json", body: '{"a":1}' },
            { key: "logs/2024/b.json", body: '{"b":2}' },
          ],
        },
        {
          service: "lambda",
          name: "inspect-type",
          function: (input) => ({
            isObject:
              input !== null &&
              typeof input === "object" &&
              !Array.isArray(input),
            hasKey: Object.prototype.hasOwnProperty.call(input, "Key"),
          }),
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, { runId: "type-read" }),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([
        { isObject: true, hasKey: true },
        { isObject: true, hasKey: true },
      ]);
    });

    test("fails when ItemReader is configured on INLINE map", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              Parameters: {
                Bucket: "source-bucket",
                Key: "items.json",
              },
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, { requestId: "inline-item-reader" }),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "RuntimeError" });
    });

    test("fails with States.ItemReaderFailed when ItemReader bucket is missing", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              Parameters: {
                Key: "items.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, {}),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "States.ItemReaderFailed" });
    });

    test("fails with States.ItemReaderFailed when ItemReader key is not found in S3", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              Parameters: {
                Bucket: "source-bucket",
                Key: "missing.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [{ key: "items.json", body: JSON.stringify([1, 2]) }],
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, {}),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({ name: "States.ItemReaderFailed" });
    });

    test("returns an empty array when ItemReader listObjectsV2 prefix has no matching objects", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Parameters: {
                Bucket: "source-bucket",
                Prefix: "missing-prefix/",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [{ key: "logs/a.json", body: "{}" }],
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, {}),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([]);
    });

    test("fails with States.ItemReaderFailed when ItemReader InputType is unsupported", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "CSV",
              },
              Parameters: {
                Bucket: "source-bucket",
                Key: "items.csv",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [{ key: "items.csv", body: "a,b,c" }],
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, {}),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({ name: "States.ItemReaderFailed" });
    });

    test("fails with States.ItemReaderFailed when ItemReader ItemsPointer is invalid", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
                ItemsPointer: "payload/records",
              },
              Parameters: {
                Bucket: "source-bucket",
                Key: "items.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            {
              key: "items.json",
              body: JSON.stringify({ payload: { records: [1, 2] } }),
            },
          ],
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, {}),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({ name: "States.ItemReaderFailed" });
    });

    test("fails with States.ItemReaderFailed when ItemReader getObject payload is not an array", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
              },
              Parameters: {
                Bucket: "source-bucket",
                Key: "not-array.json",
              },
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "source-bucket",
          objects: [
            { key: "not-array.json", body: JSON.stringify({ id: "x" }) },
          ],
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, {}),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({ name: "States.ItemReaderFailed" });
    });
  });

  describe("ItemBatcher", () => {
    test("batches items with ItemBatcher before child workflow execution", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$.items",
            ItemBatcher: {
              MaxItemsPerBatch: 2,
              BatchInput: {
                "source.$": "$.requestId",
              },
            },
            ItemProcessor: {
              StartAt: "SummariseBatch",
              States: {
                SummariseBatch: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:summarise-batch",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "lambda",
          name: "summarise-batch",
          function: (input) => ({
            source: input.BatchInput?.source,
            batchCount: input.Items?.length || 0,
          }),
        },
      ];

      const input = {
        requestId: "req-77",
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      };

      const result = await executeStateMachine(
        definition,
        getVariables(definition, input),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([
        { source: "req-77", batchCount: 2 },
        { source: "req-77", batchCount: 1 },
      ]);
    });

    test("fails when ItemBatcher MaxItemsPerBatch is zero", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ItemBatcher: {
              MaxItemsPerBatch: 0,
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [1, 2]),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "RuntimeError" });
    });

    test("fails when ItemBatcher MaxItemsPerBatch is not an integer", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ItemBatcher: {
              MaxItemsPerBatch: 1.5,
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [1, 2]),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "RuntimeError" });
    });

    test("fails when ItemBatcher BatchInput intrinsic function is invalid", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ItemBatcher: {
              MaxItemsPerBatch: 2,
              BatchInput: {
                "invalid.$": "States.NotAFunction($.value)",
              },
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [{ value: 1 }, { value: 2 }]),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "States.IntrinsicFailure" });
    });

    test("batches items using ItemBatcher MaxItemsPerBatchPath from state input", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$.items",
            ItemBatcher: {
              MaxItemsPerBatchPath: "$.batchSize",
            },
            ItemProcessor: {
              StartAt: "SummariseBatch",
              States: {
                SummariseBatch: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:summarise-batch",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "lambda",
          name: "summarise-batch",
          function: (input) => ({ batchCount: input.Items?.length || 0 }),
        },
      ];

      const input = {
        batchSize: 2,
        items: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }],
      };

      const result = await executeStateMachine(
        definition,
        getVariables(definition, input),
        getSimulatorContext({ resources })
      );

      expect(result).toEqual([
        { batchCount: 2 },
        { batchCount: 2 },
        { batchCount: 1 },
      ]);
    });

    test("fails when both ItemBatcher MaxItemsPerBatch and MaxItemsPerBatchPath are set", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$.items",
            ItemBatcher: {
              MaxItemsPerBatch: 2,
              MaxItemsPerBatchPath: "$.batchSize",
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: { Type: "Pass", End: true },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, { batchSize: 2, items: [1, 2, 3] }),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "RuntimeError" });
    });

    test("returns empty output when ItemBatcher is configured and there are no items", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ItemBatcher: {
              MaxItemsPerBatch: 2,
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const result = await executeStateMachine(
        definition,
        getVariables(definition, []),
        getSimulatorContext()
      );

      expect(result).toEqual([]);
    });
  });

  describe("ToleratedFailure*", () => {
    test("fails with States.ExceedToleratedFailureThreshold when tolerated failures are exceeded", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ToleratedFailureCount: 1,
            ItemProcessor: {
              StartAt: "AlwaysFail",
              States: {
                AlwaysFail: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:always-fail",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "lambda",
          name: "always-fail",
          function: () => {
            throw new Error("boom");
          },
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [{ id: 1 }, { id: 2 }]),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({
        name: "States.ExceedToleratedFailureThreshold",
      });
    });

    test("fails with States.ExceedToleratedFailureThreshold when tolerated failure percentage is exceeded", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ToleratedFailurePercentage: 40,
            ItemProcessor: {
              StartAt: "MaybeFail",
              States: {
                MaybeFail: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:maybe-fail",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "lambda",
          name: "maybe-fail",
          function: (input) => {
            if (input.shouldFail) {
              throw new Error("boom");
            }
            return { ok: true };
          },
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [
            { id: 1, shouldFail: true },
            { id: 2, shouldFail: true },
            { id: 3, shouldFail: false },
          ]),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({
        name: "States.ExceedToleratedFailureThreshold",
      });
    });

    test("returns failed iteration error payloads when failures are tolerated", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ToleratedFailureCount: 1,
            ItemProcessor: {
              StartAt: "MaybeFail",
              States: {
                MaybeFail: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:maybe-fail",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "lambda",
          name: "maybe-fail",
          function: (input) => {
            if (input.shouldFail) {
              throw new Error("boom");
            }
            return { id: input.id, ok: true };
          },
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, [
          { id: 1, shouldFail: false },
          { id: 2, shouldFail: true },
          { id: 3, shouldFail: false },
        ]),
        getSimulatorContext({ resources })
      );

      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: 1, ok: true });
      expect(result[1]).toMatchObject({
        Error: "States.TaskFailed",
        Cause: expect.any(String),
      });
      expect(result[1].Cause).toContain("boom");
      expect(result[2]).toEqual({ id: 3, ok: true });
    });

    test("throws original task failure when items fail and no tolerated failure threshold is configured", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ItemProcessor: {
              StartAt: "AlwaysFail",
              States: {
                AlwaysFail: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:always-fail",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "lambda",
          name: "always-fail",
          function: () => {
            throw new Error("boom");
          },
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [1, 2]),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({ name: "States.TaskFailed" });
    });

    test("fails when ToleratedFailureCount is invalid", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ToleratedFailureCount: -1,
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [1]),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "RuntimeError" });
    });

    test("fails when ToleratedFailurePercentage is invalid", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ToleratedFailurePercentage: 120,
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [1]),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "RuntimeError" });
    });

    test("fails when ToleratedFailureCountPath resolves to undefined", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$.items",
            ToleratedFailureCountPath: "$.missingThreshold",
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, { items: [1] }),
          getSimulatorContext()
        )
      ).rejects.toMatchObject({ name: "RuntimeError" });
    });

    test("does not exceed tolerated failure count when failed item count equals threshold", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ToleratedFailureCount: 1,
            ItemProcessor: {
              StartAt: "MaybeFail",
              States: {
                MaybeFail: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:maybe-fail",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "lambda",
          name: "maybe-fail",
          function: (input) => {
            if (input.fail) {
              throw new Error("boom");
            }
            return { ok: true };
          },
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, [{ fail: true }, { fail: false }]),
        getSimulatorContext({ resources })
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ Error: "States.TaskFailed" });
      expect(result[1]).toEqual({ ok: true });
    });

    test("fails with States.ExceedToleratedFailureThreshold when failure count is above threshold", async () => {
      const definition = {
        QueryLanguage: "JSONPath",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemsPath: "$",
            ToleratedFailureCount: 1,
            ItemProcessor: {
              StartAt: "AlwaysFail",
              States: {
                AlwaysFail: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:always-fail",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "lambda",
          name: "always-fail",
          function: () => {
            throw new Error("boom");
          },
        },
      ];

      await expect(() =>
        executeStateMachine(
          definition,
          getVariables(definition, [{ id: 1 }, { id: 2 }]),
          getSimulatorContext({ resources })
        )
      ).rejects.toMatchObject({
        name: "States.ExceedToleratedFailureThreshold",
      });
    });
  });

  // Statelint (@wmfs/statelint) does not yet recognise ItemReader, ItemBatcher,
  // ProcessorConfig, or ToleratedFailure*. Until it does, callers must use
  // validateDefinition: false to opt out.
  describe("load() integration with validateDefinition: false", () => {
    test("end-to-end Map with ItemReader, ItemBatcher and ToleratedFailure*", async () => {
      const definition = {
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              Parameters: { Bucket: "input-bucket", Key: "items.json" },
              ReaderConfig: { InputType: "JSON" },
            },
            ItemBatcher: { MaxItemsPerBatch: 2 },
            ToleratedFailureCount: 0,
            ToleratedFailurePercentage: 100,
            ItemProcessor: {
              StartAt: "EchoBatch",
              ProcessorConfig: { Mode: "DISTRIBUTED", ExecutionType: "STANDARD" },
              States: {
                EchoBatch: { Type: "Pass", End: true },
              },
            },
            End: true,
          },
        },
      };

      const resources = [
        {
          service: "s3",
          name: "input-bucket",
          objects: [
            { key: "items.json", body: JSON.stringify([{ id: 1 }, { id: 2 }, { id: 3 }]) },
          ],
        },
      ];

      const stateMachine = load(definition, resources, {
        validateDefinition: false,
      });
      const result = await stateMachine.execute({});

      expect(result).toEqual([
        { Items: [{ id: 1 }, { id: 2 }] },
        { Items: [{ id: 3 }] },
      ]);
    });
  });
});
