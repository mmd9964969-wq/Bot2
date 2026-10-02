import type { InstallationOperationForOrchestrator } from "./installation-types.ts";

export type CapabilityStatus =
  | "NOT_INSTALLED"
  | "INSTALLING"
  | "INSTALLED"
  | "DISABLING"
  | "DISABLED"
  | "FAILED";

export type InstallationCapabilityDefinition = {
  id: string;
  label: string;
  version: string;
  required: boolean;
  dependencies: string[];
};

export const INSTALLATION_CAPABILITIES: InstallationCapabilityDefinition[] = [
  {
    id: "command-runtime",
    label: "Command Runtime",
    version: "1",
    required: true,
    dependencies: [],
  },
  {
    id: "member-registry",
    label: "Member Registry",
    version: "1",
    required: true,
    dependencies: [],
  },
  {
    id: "moderation",
    label: "Moderation",
    version: "1",
    required: true,
    dependencies: ["command-runtime"],
  },
  {
    id: "locks",
    label: "Content Locks",
    version: "1",
    required: true,
    dependencies: ["command-runtime"],
  },
  {
    id: "cleanup",
    label: "Cleanup",
    version: "1",
    required: true,
    dependencies: ["command-runtime"],
  },
  {
    id: "stats",
    label: "Stats Center",
    version: "1",
    required: true,
    dependencies: ["command-runtime", "member-registry"],
  },
  {
    id: "date",
    label: "Date Center",
    version: "1",
    required: true,
    dependencies: ["command-runtime"],
  },
  {
    id: "automation",
    label: "Automation",
    version: "1",
    required: true,
    dependencies: ["command-runtime"],
  },
  {
    id: "audit",
    label: "Audit",
    version: "1",
    required: true,
    dependencies: ["command-runtime"],
  },
];

function validateRegistry(definitions: InstallationCapabilityDefinition[]) {
  const ids = new Set<string>();

  for (const definition of definitions) {
    if (ids.has(definition.id)) {
      throw new Error("شناسهٔ Capability تکراری است: " + definition.id);
    }
    ids.add(definition.id);
  }

  for (const definition of definitions) {
    for (const dependency of definition.dependencies) {
      if (!ids.has(dependency)) {
        throw new Error(
          "Dependency پیدا نشد: " + definition.id + " -> " + dependency,
        );
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error("چرخهٔ Dependency در Capability Registry پیدا شد: " + id);
    }

    visiting.add(id);
    const definition = definitions.find((item) => item.id === id);
    if (!definition) throw new Error("Capability پیدا نشد: " + id);

    for (const dependency of definition.dependencies) {
      visit(dependency);
    }

    visiting.delete(id);
    visited.add(id);
  };

  for (const definition of definitions) {
    visit(definition.id);
  }
}

function topologicalOrder(definitions: InstallationCapabilityDefinition[]) {
  validateRegistry(definitions);

  const visited = new Set<string>();
  const result: InstallationCapabilityDefinition[] = [];

  const visit = (id: string) => {
    if (visited.has(id)) return;
    const definition = definitions.find((item) => item.id === id);
    if (!definition) throw new Error("Capability پیدا نشد: " + id);

    for (const dependency of definition.dependencies) {
      visit(dependency);
    }

    visited.add(id);
    result.push(definition);
  };

  for (const definition of definitions) {
    visit(definition.id);
  }

  return result;
}

export function capabilityActivationOrder(
  definitions = INSTALLATION_CAPABILITIES,
) {
  return topologicalOrder(definitions);
}

export function capabilityDeactivationOrder(
  definitions = INSTALLATION_CAPABILITIES,
) {
  return [...topologicalOrder(definitions)].reverse();
}

export function capabilityMap(
  definitions = INSTALLATION_CAPABILITIES,
) {
  return new Map(definitions.map((definition) => [definition.id, definition]));
}

// Kept as a lightweight compile-time contract for future operation-specific
// capability policies without coupling the Registry to the controller.
export type { InstallationOperationForOrchestrator };
