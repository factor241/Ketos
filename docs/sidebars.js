module.exports = {
  docs: [
    {
      type: "html",
      value: `<div class="sidebar-group-label">Build</div>`,
      className: "sidebar-group-divider",
    },
    {
      type: "category",
      label: "Get started",
      className: "sidebar-category-with-icon sidebar-icon-rocket",
      items: [
        {
          type: "doc",
          id: "Get-Started/about-langflow",
          label: "About Ketos"
        },
        {
          type: "doc",
          id: "Get-Started/get-started-installation",
          label: "Install Ketos"
        },
        {
          type: "doc",
          id: "Get-Started/get-started-quickstart",
          label: "Quickstart"
        },
        {
          type: "category",
          label: "Tutorials",
          items: [
            "Tutorials/chat-with-rag",
            "Tutorials/chat-with-files",
            "Tutorials/agent",
            "Tutorials/mcp-tutorial",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Flows",
      className: "sidebar-category-with-icon sidebar-icon-workflow",
      items: [
        {
          type: "doc",
          id: "Flows/concepts-overview",
          label: "Use the visual editor"
        },
        {
          type: "doc",
          id: "Flows/concepts-flows",
          label: "Build flows"
        },
        {
          type: "category",
          label: "Run flows",
          items: [
            {
              type: "doc",
              id: "Flows/concepts-publish",
              label: "Trigger flows with the Ketos API"
            },
            {
              type: "doc",
              id: "Flows/webhook",
              label: "Trigger flows with webhooks"
            },
          ],
        },
        {
          type: "doc",
          id: "Flows/concepts-playground",
          label: "Test flows"
        },
        {
          type: "doc",
          id: "Flows/concepts-flows-import",
          label: "Import and export flows"
        },
        {
          type: "doc",
          id: "Flows/langflow-assistant",
          label: "Build flows and components with Ketos Assistant"
        },
      ],
    },
    {
      type: "category",
      label: "Agents",
      className: "sidebar-category-with-icon sidebar-icon-bot",
      items: [
        "Agents/agents",
        "Agents/agents-tools",
      ],
    },
    {
      type: "category",
      label: "Model Context Protocol (MCP)",
      className: "sidebar-category-with-icon sidebar-icon-plug",
      items: [
        "Agents/mcp-client",
        "Agents/mcp-server",
        "Agents/langflow-mcp-client",
        "Agents/mcp-component-astra",
      ],
    },
    {
      type: "html",
      value: `<div class="sidebar-group-label">Develop & Deploy</div>`,
      className: "sidebar-group-divider",
    },
    {
      type: "category",
      label: "Develop",
      className: "sidebar-category-with-icon sidebar-icon-code",
      items: [
        "Develop/api-keys-and-authentication",
        "Develop/jwt-authentication",
        "Develop/install-custom-dependencies",
        "Develop/configuration-global-variables",
        "Develop/environment-variables",
        {
          type: "category",
          label: "Storage and memory",
          items: [
            {
              type: "doc",
              id: "Develop/concepts-file-management",
              label: "Manage files"
            },
            {
              type: "doc",
              id: "Develop/memory",
              label: "Manage memory"
            },
            {
              type: "doc",
              id: "Develop/session-id",
              label: "Use Session IDs"
            },
            "Develop/configuration-custom-database",
            {
              type: "doc",
              id: "Develop/enterprise-database-guide",
              label: "Database guide for enterprise administrators"
            },
            "Develop/knowledge",
            "Develop/memory-bases",
          ],
        },
        {
          type: "category",
          label: "Observability",
          items: [
            "Develop/logging",
            "Develop/observability-grafana-loki",
            "Develop/traces",
            {
              type: "category",
              label: "Monitoring",
              items: [
                "Develop/integrations-arize",
                "Develop/observability-grafana-loki",
                "Develop/integrations-langfuse",
                "Develop/integrations-langsmith",
                "Develop/integrations-langwatch",
                "Develop/integrations-openlayer",
                "Develop/integrations-opik",
                "Develop/integrations-instana-traceloop",
              ],
            },
            "Develop/contributing-telemetry",
          ],
        },
        {
          type: "doc",
          id: "Develop/data-types",
          label: "Use Ketos data types"
        },
        {
          type: "doc",
          id: "Develop/concepts-voice-mode",
          label: "Use voice mode"
        },
        {
          type: "doc",
          id: "Develop/configuration-cli",
          label: "Use the Ketos CLI"
        },
        {
          type: "category",
          label: "Bundle extensions",
          items: [
            "Develop/extensions-overview",
            "Develop/extensions-quickstart",
            "Develop/extensions-manifest",
          ],
        },
      ],
    },
    {
      type: "category",
      label: "Deploy",
      className: "sidebar-category-with-icon sidebar-icon-cloud",
      items: [
        {
          type:"doc",
          id: "Deployment/deployment-overview",
          label: "Ketos deployment overview"
        },
        {
          type: "doc",
          id: "Deployment/deployment-public-server",
          label: "Deploy a public Ketos server"
        },
        {
          type: "doc",
          id: "Deployment/deployment-nginx-ssl",
          label: "Deploy Ketos with Nginx and SSL"
        },
        {
          type: "doc",
          id: "Deployment/deployment-wxo",
          label: "Deploy flows on watsonx Orchestrate"
        },
        {
          type: "category",
          label: "Containerized deployments",
          items: [
            "Deployment/develop-application",
            {
              type: "doc",
              id: "Deployment/deployment-docker",
              label: "Ketos Docker images"
            },
            {
              type: "doc",
              id: "Deployment/deployment-caddyfile",
              label: "Deploy Ketos on a remote server"
            },
            {
              type: "category",
              label: "Kubernetes",
              items: [
                {
                  type: "doc",
                  id: "Deployment/deployment-architecture",
                  label: "Deployment architecture"
                },
                {
                  type: "doc",
                  id: "Deployment/deployment-prod-best-practices",
                  label: "Best practices"
                },
                {
                  type: "doc",
                  id: "Deployment/deployment-kubernetes-dev",
                  label: "Deploy in development"
                },
                {
                  type: "doc",
                  id: "Deployment/deployment-kubernetes-prod",
                  label: "Deploy in production"
                },
              ]
            },
          ],
        },
        {
          type: "category",
          label: "Cloud platforms",
          items: [
            {
              type: "doc",
              id: "Deployment/deployment-gcp",
              label: "Google Cloud Platform"
            },
            {
              type: "doc",
              id: "Deployment/deployment-hugging-face-spaces",
              label: "Hugging Face Spaces"
            },
            {
              type: "doc",
              id: "Deployment/deployment-railway",
              label: "Railway"
            },
            {
              type: "doc",
              id: "Deployment/deployment-render",
              label: "Render"
            },
          ]
        },
        {
          type: "doc",
          id: "Deployment/deployment-multi-worker",
          label: "Deploy Ketos with multiple workers",
        },
        {
          type: "doc",
          id: "Deployment/deployment-lfx-compatibility",
          label: "KFX and Ketos version compatibility",
        },
        {
          type: "doc",
          id: "Deployment/deployment-block-custom-components",
          label: "Block custom components",
        },
        {
          type: "doc",
          id: "Deployment/security",
          label: "Security",
        },
      ],
    },
    {
      type: "html",
      value: `<div class="sidebar-group-label">Reference</div>`,
      className: "sidebar-group-divider",
    },
    {
      type: "category",
      label: "Components reference",
      className: "sidebar-category-with-icon sidebar-icon-blocks",
      items: [
        "Components/concepts-components",
        {
          type: "category",
          label: "Core components",
          items: [
            {
              type: "category",
              label: "Input / Output",
              items: [
                "Components/chat-input-and-output",
                "Components/webhook",
              ]
            },
            {
              type: "category",
              label: "Processing",
              items: [
                "Components/data-operations",
                "Components/dataframe-operations",
                "Components/dynamic-create-data",
                "Components/parser",
                "Components/split-text",
                "Components/text-operations",
                "Components/type-convert",
              ]
            },
            {
              type: "category",
              label: "Data Source",
              items: [
                "Components/api-request",
                "Components/mock-data",
                "Components/url",
                "Components/web-search",
              ]
            },
            {
              type: "category",
              label: "Files and Knowledge",
              items: [
                "Components/file-system",
                "Components/knowledge-base",
                "Components/memory-base",
                "Components/read-file",
                "Components/write-file",
              ]
            },
            {
              type: "category",
              label: "Flow Controls",
              items: [
                "Components/if-else",
                "Components/loop",
                "Components/notify-and-listen",
                "Components/run-flow",
              ]
            },
            {
              type: "category",
              label: "LLM Operations",
              items: [
                "Components/batch-run",
                "Components/guardrails",
                "Components/policies",
                "Components/llm-selector",
                "Components/smart-router",
                "Components/smart-transform",
                "Components/structured-output",
              ]
            },
            {
              type: "category",
              label: "Models and Agents",
              items: [
                "Components/components-models",
                "Components/components-prompts",
                "Components/components-agents",
                "Components/mcp-tools",
                "Components/components-embedding-models",
                "Components/message-history",
              ]
            },
            {
              type: "category",
              label: "Utilities",
              items: [
                "Components/calculator",
                "Components/current-date",
                "Components/python-interpreter",
                "Components/sql-database",
              ]
            },
            "Components/legacy-core-components",
          ],
        },
        {
          type: "category",
          label: "Bundles",
          items: [
            "Components/components-bundles",
            "Components/bundles-agentics",
            "Components/bundles-aiml",
            "Components/bundles-altk",
            "Components/bundles-amazon",
            "Components/bundles-anthropic",
            "Components/bundles-apify",
            "Components/bundles-arxiv",
            "Components/bundles-assemblyai",
            "Components/bundles-azure",
            "Components/bundles-baidu",
            "Components/bundles-bing",
            "Components/bundles-cassandra",
            "Components/bundles-chroma",
            "Components/bundles-cleanlab",
            "Components/bundles-codeagents",
            "Components/bundles-clickhouse",
            "Components/bundles-cloudflare",
            "Components/bundles-cohere",
            "Components/bundles-cometapi",
            "Components/bundles-composio",
            "Components/bundles-couchbase",
            "Components/bundles-cuga",
            "Components/bundles-datastax",
            "Components/bundles-deepseek",
            "Components/bundles-docling",
            "Components/bundles-duckduckgo",
            "Components/bundles-elastic",
            "Components/bundles-exa",
            "Components/bundles-faiss",
            "Components/bundles-files-ingestion",
            "Components/bundles-firecrawl",
            "Components/bundles-glean",
            "Components/bundles-google",
            "Components/bundles-groq",
            "Components/bundles-huggingface",
            "Components/bundles-ibm",
            "Components/bundles-icosacomputing",
            "Components/bundles-langchain",
            "Components/bundles-lite-llm",
            "Components/bundles-lmstudio",
            "Components/bundles-maritalk",
            "Components/bundles-mem0",
            "Components/bundles-milvus",
            "Components/bundles-mistralai",
            "Components/bundles-mongodb",
            "Components/bundles-notion",
            "Components/bundles-novita",
            "Components/bundles-nvidia",
            "Components/bundles-ollama",
            "Components/bundles-openai",
            "Components/bundles-openrouter",
            "Components/bundles-perplexity",
            "Components/bundles-pgvector",
            "Components/bundles-pinecone",
            "Components/bundles-qdrant",
            "Components/bundles-redis",
            "Components/bundles-sambanova",
            "Components/bundles-searchapi",
            "Components/bundles-serper",
            "Components/bundles-supabase",
            "Components/bundles-upstash",
            "Components/bundles-vllm",
            "Components/bundles-vectara",
            "Components/bundles-vertexai",
            "Components/bundles-weaviate",
            "Components/bundles-wikipedia",
            "Components/bundles-xai",
          ],
        },
        "Components/components-custom-components",
      ],
    },
    {
      type: "category",
      label: "API reference",
      className: "sidebar-category-with-icon sidebar-icon-fileCode",
      items: [
        {
          type: "doc",
          id: "API-Reference/api-reference-api-examples",
          label: "Get started with the Ketos API",
        },
        {
          type: "doc",
          id: "API-Reference/typescript-client",
          label: "Use the TypeScript client"
        },
        {
          type: "doc",
          id: "API-Reference/flow-devops-sdk",
          label: "Flow DevOps Toolkit SDK",
        },
        {
          type: "doc",
          id: "API-Reference/api-flows-run",
          label: "Flow trigger endpoints",
        },
        {
          type: "category",
          label: "Developer API (Beta)",
          items: [
            "API-Reference/workflows-api",
            {
              type: "link",
              label: "Workflow API specification (Beta)",
              href: "/api/workflow",
            },
          ],
        },
        "API-Reference/api-openai-responses",
        "API-Reference/api-flows",
        "API-Reference/api-files",
        "API-Reference/api-projects",
        "API-Reference/api-logs",
        "API-Reference/api-monitor",
        "API-Reference/api-build",
        "API-Reference/api-users",
        {
          type: "link",
          label: "Ketos API specification",
          href: "/api",
        },
      ],
    },
    {
      type: "category",
      label: "Support",
      className: "sidebar-category-with-icon sidebar-icon-helpCircle",
      items: [
        {
          type: "doc",
          id: "Support/troubleshooting",
          label: "Troubleshoot",
        },
        {
          type: "doc",
          id: "Support/macos-support-matrix",
          label: "macOS support",
        },
        {
          type: "doc",
          id: "Support/release-notes",
          label: "Release notes",
        },
      ],
    },
  ],
};
