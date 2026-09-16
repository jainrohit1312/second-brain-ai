'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/Button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/Card';

/**
 * Embedding providers the retrieval pipeline can be pointed at. The vector width is a property of
 * the provider, not a preference: see the re-embed warning below.
 */
export type EmbeddingProviderId = 'nvidia' | 'openai' | 'gemini';

/** Chat/classification providers the processing and retrieval services can be pointed at. */
export type LlmProviderId = 'deepseek' | 'anthropic' | 'openai' | 'qwen' | 'local';

/** Any provider id this surface can select. */
export type ProviderId = EmbeddingProviderId | LlmProviderId;

/**
 * One selectable embedding provider.
 *
 * `apiKeyEnv` names the variable the **services** read; keys are never sent to or stored by this
 * app, so the settings UI can only report which variable is expected.
 */
export interface EmbeddingProviderOption {
  id: EmbeddingProviderId;
  label: string;
  models: readonly string[];
  /** Vector width produced by the provider's models. */
  dimensions: number;
  apiKeyEnv: string;
}

/** One selectable LLM provider. */
export interface LlmProviderOption {
  id: LlmProviderId;
  label: string;
  models: readonly string[];
  apiKeyEnv: string;
}

/**
 * Provider catalogue.
 *
 * TODO(phase-2): move these unions and option lists into `@second-brain/shared` (next to the
 * provider adapter registry in `packages/providers`). They are duplicated here only because the
 * registry does not exist yet and deep imports across workspaces are forbidden.
 */
export const EMBEDDING_PROVIDERS: readonly EmbeddingProviderOption[] = [
  {
    id: 'nvidia',
    label: 'NVIDIA NIM',
    models: ['nvidia/nv-embedqa-e5-v5'],
    dimensions: 1024,
    apiKeyEnv: 'NVIDIA_API_KEY',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['text-embedding-3-small', 'text-embedding-3-large'],
    dimensions: 1536,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    models: ['text-embedding-004'],
    dimensions: 768,
    apiKeyEnv: 'GEMINI_API_KEY',
  },
];

/** LLM catalogue; models are the subset the pipeline is benchmarked against. */
export const LLM_PROVIDERS: readonly LlmProviderOption[] = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: ['claude-3-5-sonnet-latest', 'claude-3-5-haiku-latest'],
    apiKeyEnv: 'ANTHROPIC_API_KEY',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    models: ['gpt-4o-mini', 'gpt-4o'],
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    id: 'qwen',
    label: 'Qwen (DashScope)',
    models: ['qwen-plus', 'qwen-max'],
    apiKeyEnv: 'DASHSCOPE_API_KEY',
  },
  {
    id: 'local',
    label: 'Local (Ollama / vLLM)',
    models: [],
    apiKeyEnv: 'LOCAL_LLM_BASE_URL',
  },
];

const DEFAULT_EMBEDDING_PROVIDER: EmbeddingProviderId = 'nvidia';
const DEFAULT_EMBEDDING_MODEL = 'nvidia/nv-embedqa-e5-v5';
const DEFAULT_LLM_PROVIDER: LlmProviderId = 'deepseek';
const DEFAULT_LLM_MODEL = 'deepseek-chat';

export interface ProviderConfigProps {
  className?: string;
}

/**
 * Provider pickers for the embedding and chat models, plus a connectivity test.
 *
 * Selections are local state only: nothing is persisted and no request is sent yet, so the
 * "Test connection" button deliberately stays pending after it is clicked.
 */
export function ProviderConfig({ className }: ProviderConfigProps) {
  const [embeddingProviderId, setEmbeddingProviderId] = useState<EmbeddingProviderId>(
    DEFAULT_EMBEDDING_PROVIDER,
  );
  const [embeddingModel, setEmbeddingModel] = useState(DEFAULT_EMBEDDING_MODEL);
  const [llmProviderId, setLlmProviderId] = useState<LlmProviderId>(DEFAULT_LLM_PROVIDER);
  const [llmModel, setLlmModel] = useState(DEFAULT_LLM_MODEL);
  const [isTesting, setIsTesting] = useState(false);

  const embeddingProvider = EMBEDDING_PROVIDERS.find(
    (provider) => provider.id === embeddingProviderId,
  );
  const llmProvider = LLM_PROVIDERS.find((provider) => provider.id === llmProviderId);
  const embeddingModels: readonly string[] = embeddingProvider?.models ?? [];
  const llmModels: readonly string[] = llmProvider?.models ?? [];

  /** Switching embedding provider also resets the model, since models are provider-specific. */
  const handleEmbeddingProviderChange = (nextId: EmbeddingProviderId) => {
    setEmbeddingProviderId(nextId);
    setEmbeddingModel(
      EMBEDDING_PROVIDERS.find((provider) => provider.id === nextId)?.models[0] ?? '',
    );
  };

  const handleLlmProviderChange = (nextId: LlmProviderId) => {
    setLlmProviderId(nextId);
    setLlmModel(LLM_PROVIDERS.find((provider) => provider.id === nextId)?.models[0] ?? '');
  };

  /** TODO(phase-2): POST /providers/test with both selections and resolve `isTesting` on response. */
  const handleTestConnection = () => {
    setIsTesting(true);
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Providers</CardTitle>
        <CardDescription>
          Which models embed your captures and which model writes the answers.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <SelectField
            label="Embedding provider"
            value={embeddingProviderId}
            onChange={handleEmbeddingProviderChange}
            options={EMBEDDING_PROVIDERS.map((provider) => ({
              value: provider.id,
              label: provider.label,
            }))}
            hint={
              embeddingProvider
                ? `Produces ${embeddingProvider.dimensions}-dimension vectors.`
                : undefined
            }
          />
          <SelectField
            label="Embedding model"
            value={embeddingModel}
            onChange={setEmbeddingModel}
            options={embeddingModels.map((model) => ({
              value: model,
              label: model,
            }))}
            hint={
              embeddingModels.length === 0
                ? 'No models are published for this provider.'
                : undefined
            }
          />
          <SelectField
            label="Chat / LLM provider"
            value={llmProviderId}
            onChange={handleLlmProviderChange}
            options={LLM_PROVIDERS.map((provider) => ({
              value: provider.id,
              label: provider.label,
            }))}
            hint={llmProvider ? `Key read from ${llmProvider.apiKeyEnv}.` : undefined}
          />
          <SelectField
            label="Chat model"
            value={llmModel}
            onChange={setLlmModel}
            options={llmModels.map((model) => ({ value: model, label: model }))}
            hint={llmModels.length === 0 ? 'Uses LOCAL_LLM_MODEL from .env.' : undefined}
          />
        </div>

        <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs leading-relaxed text-muted-foreground">
          Changing the embedding provider or model changes the vector width
          {embeddingProvider ? ` (${embeddingProvider.dimensions} dims)` : ''}, so it requires a
          re-embed migration: every chunk and memory vector has to be recomputed before retrieval
          returns results again. Plan the migration before saving this change — see
          docs/DECISIONS.md (ADR-004).
        </p>
      </CardContent>

      <CardFooter className="justify-between">
        <p className="text-xs text-muted-foreground">
          Keys live in the repo-root <code>.env</code>; this app never receives them.
        </p>
        <Button variant="secondary" isLoading={isTesting} onClick={handleTestConnection}>
          Test connection
        </Button>
      </CardFooter>
    </Card>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
  hint?: string | undefined;
}

/**
 * Labelled native select. The cast inside `onChange` is safe because every `option` value comes
 * from the same typed catalogue the generic was inferred from.
 *
 * TODO(phase-2): extract a `Select` primitive next to `Input` instead of styling native elements.
 */
function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
}: SelectFieldProps<T>) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <span className="font-normal">{hint}</span> : null}
    </label>
  );
}
