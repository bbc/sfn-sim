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
  queryLanguage: "JSONata",
  ...overrides,
});

describe("Map state (JSONata)", () => {
  describe("Execution and context", () => {
    test("uses parent map input for $states.input and map item value via context", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input.items %}",
            ItemSelector: {
              requestId: "{% $states.input.requestId %}",
              number: "{% $states.context.Map.Item.Value.number %}",
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const input = {
        requestId: "req-123",
        items: [{ number: 1 }, { number: 2 }],
      };

      const result = await executeStateMachine(
        definition,
        getVariables(definition, input),
        getSimulatorContext()
      );

      expect(result).toEqual([
        { requestId: "req-123", number: 1 },
        { requestId: "req-123", number: 2 },
      ]);
    });

    test("keeps parent Execution context for INLINE map iterations", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "Map Step",
        States: {
          "Map Step": {
            Type: "Map",
            Items: "{% $states.input %}",
            ItemProcessor: {
              StartAt: "InspectExecutionInput",
              States: {
                InspectExecutionInput: {
                  Type: "Pass",
                  Output: {
                    item: "{% $states.context.Map.Item.Value %}",
                    executionInput: "{% $states.context.Execution.Input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "My Map Step",
        States: {
          "My Map Step": {
            Type: "Map",
            Label: "Custom Label Name",
            Items: "{% $states.input %}",
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "InspectDistributedExecution",
              States: {
                InspectDistributedExecution: {
                  Type: "Task",
                  Resource:
                    "arn:aws:lambda:::function:inspect-distributed-execution",
                  Output: {
                    item: "{% $states.input %}",
                    executionInput: "{% $states.context.Execution.Input %}",
                    executionId: "{% $states.context.Execution.Id %}",
                    executionName: "{% $states.context.Execution.Name %}",
                    executionStartTime:
                      "{% $states.context.Execution.StartTime %}",
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
          service: "lambda",
          name: "inspect-distributed-execution",
          function: async (input) => {
            const delayMs = (4 - input) * 10;
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            return input;
          },
        },
      ];

      const result = await executeStateMachine(
        definition,
        getVariables(definition, [1, 2, 3]),
        getSimulatorContext({ resources })
      );

      expect(result).toHaveLength(3);
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
    test("reads items using ItemReader before running item processor", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
              },
              Arguments: {
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
                  Output: {
                    id: "{% $states.context.Map.Item.Value.id %}",
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

    test("resolves ItemReader Arguments Bucket and Key from state input", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
              },
              Arguments: {
                Bucket: "{% $states.input.reader.bucket %}",
                Key: "{% $states.input.reader.key %}",
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
                  Output: {
                    id: "{% $states.context.Map.Item.Value.id %}",
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
        QueryLanguage: "JSONata",
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
              Arguments: {
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
                  Output: {
                    id: "{% $states.context.Map.Item.Value.id %}",
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
        QueryLanguage: "JSONata",
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
              Arguments: {
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
                  Output: {
                    id: "{% $states.context.Map.Item.Value.id %}",
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

    test("reads a list of S3 objects from a prefix using ItemReader listObjectsV2", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Arguments: {
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
                  Output: "{% $states.input %}",
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

    test("resolves ItemReader Arguments Bucket and Prefix from state input for listObjectsV2", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Arguments: {
                Bucket: "{% $states.input.reader.bucket %}",
                Prefix: "{% $states.input.reader.prefix %}",
              },
            },
            ItemSelector: {
              key: "{% $states.context.Map.Item.Value.Key %}",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Arguments: {
                Bucket: "source-bucket",
                Prefix: "logs/2024/",
              },
            },
            ItemSelector: {
              key: "{% $states.context.Map.Item.Value.Key %}",
              bytes: "{% $states.context.Map.Item.Value.Size %}",
              class: "{% $states.context.Map.Item.Value.StorageClass %}",
            },
            ItemProcessor: {
              ProcessorConfig: {
                Mode: "DISTRIBUTED",
              },
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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

    test("fails when ItemReader is configured on INLINE map", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              Arguments: {
                Bucket: "source-bucket",
                Key: "items.json",
              },
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              Arguments: {
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
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              Arguments: {
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
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:listObjectsV2",
              Arguments: {
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
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "CSV",
              },
              Arguments: {
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
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
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
              Arguments: {
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
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              ReaderConfig: {
                InputType: "JSON",
              },
              Arguments: {
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
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input.items %}",
            ItemBatcher: {
              MaxItemsPerBatch: 2,
              BatchInput: {
                source: "{% $states.input.requestId %}",
              },
            },
            ItemProcessor: {
              StartAt: "SummariseBatch",
              States: {
                SummariseBatch: {
                  Type: "Pass",
                  Output: {
                    source: "{% $states.input.BatchInput.source %}",
                    batchCount: "{% $count($states.input.Items) %}",
                  },
                  End: true,
                },
              },
            },
            End: true,
          },
        },
      };

      const input = {
        requestId: "req-77",
        items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      };

      const result = await executeStateMachine(
        definition,
        getVariables(definition, input),
        getSimulatorContext()
      );

      expect(result).toEqual([
        { source: "req-77", batchCount: 2 },
        { source: "req-77", batchCount: 1 },
      ]);
    });

    test("fails when ItemBatcher MaxItemsPerBatch is zero", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
            ItemBatcher: {
              MaxItemsPerBatch: 0,
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
            ItemBatcher: {
              MaxItemsPerBatch: 1.5,
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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

    test("fails when ItemBatcher BatchInput JSONata expression is invalid", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
            ItemBatcher: {
              MaxItemsPerBatch: 2,
              BatchInput: "{% $notAFunction( %}",
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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
      ).rejects.toBeDefined();
    });

    test("returns empty output when ItemBatcher is configured and there are no items", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
            ItemBatcher: {
              MaxItemsPerBatch: 2,
            },
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
            ToleratedFailureCount: 1,
            ItemProcessor: {
              StartAt: "MaybeFail",
              States: {
                MaybeFail: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:maybe-fail",
                  Output: "{% $states.result.Payload %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
            ToleratedFailureCount: -1,
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
            ToleratedFailurePercentage: 120,
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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

    test("fails when ToleratedFailureCount expression resolves to undefined", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input.items %}",
            ToleratedFailureCount: "{% $states.input.missingThreshold %}",
            ItemProcessor: {
              StartAt: "ReturnInput",
              States: {
                ReturnInput: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
            ToleratedFailureCount: 1,
            ItemProcessor: {
              StartAt: "MaybeFail",
              States: {
                MaybeFail: {
                  Type: "Task",
                  Resource: "arn:aws:lambda:::function:maybe-fail",
                  Output: "{% $states.result.Payload %}",
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
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            Items: "{% $states.input %}",
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

  // Statelint (@wmfs/statelint) does not yet recognise QueryLanguage,
  // ItemReader, ItemBatcher, ProcessorConfig, or ToleratedFailure*. Until it
  // does, callers must use validateDefinition: false to opt out.
  describe("load() integration with validateDefinition: false", () => {
    test("end-to-end Map with ItemReader, ItemBatcher and ToleratedFailure*", async () => {
      const definition = {
        QueryLanguage: "JSONata",
        StartAt: "MapStep",
        States: {
          MapStep: {
            Type: "Map",
            ItemReader: {
              Resource: "arn:aws:states:::s3:getObject",
              Arguments: { Bucket: "input-bucket", Key: "items.json" },
              ReaderConfig: { InputType: "JSON" },
            },
            ItemBatcher: { MaxItemsPerBatch: 2 },
            ToleratedFailureCount: 0,
            ToleratedFailurePercentage: 100,
            ItemProcessor: {
              QueryLanguage: "JSONata",
              StartAt: "EchoBatch",
              ProcessorConfig: { Mode: "DISTRIBUTED", ExecutionType: "STANDARD" },
              States: {
                EchoBatch: {
                  Type: "Pass",
                  Output: "{% $states.input %}",
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
