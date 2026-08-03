import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as ts from "typescript";
import {
  OPERATIONAL_WRITE_ALLOWED_ACTIONS,
  OPERATIONAL_WRITE_CONTROLLER_MODULES
} from "./operational-write-freeze.registry";

const MUTATION_DECORATORS = new Set(["Delete", "Patch", "Post", "Put"]);

interface MutationAction {
  controller: string;
  handler: string;
  sourceFile: string;
}

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith(".controller.ts") ? [path] : [];
  });
}

function decoratorName(decorator: ts.Decorator): string | null {
  const expression = decorator.expression;
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) {
    return expression.expression.text;
  }
  if (ts.isIdentifier(expression)) return expression.text;
  return null;
}

function decorators(node: ts.Node): readonly ts.Decorator[] {
  return ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
}

function mutationActions(): MutationAction[] {
  const root = join(__dirname, "..");
  return sourceFiles(root).flatMap((sourceFile) => {
    const source = ts.createSourceFile(
      sourceFile,
      readFileSync(sourceFile, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const actions: MutationAction[] = [];
    source.forEachChild((node) => {
      if (!ts.isClassDeclaration(node) || !node.name) return;
      const isController = decorators(node).some(
        (decorator) => decoratorName(decorator) === "Controller"
      );
      if (!isController) return;
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member) || !ts.isIdentifier(member.name)) continue;
        const isMutation = decorators(member).some((decorator) => {
          const name = decoratorName(decorator);
          return name !== null && MUTATION_DECORATORS.has(name);
        });
        if (isMutation) {
          actions.push({
            controller: node.name!.text,
            handler: member.name.text,
            sourceFile
          });
        }
      }
    });
    return actions;
  });
}

describe("operational write freeze classification", () => {
  it("classifies every current mutation controller or explicitly allows one safe action", () => {
    const actions = mutationActions();
    const unclassified = actions.filter(
      ({ controller, handler }) =>
        !OPERATIONAL_WRITE_ALLOWED_ACTIONS.has(`${controller}.${handler}`) &&
        !OPERATIONAL_WRITE_CONTROLLER_MODULES[controller]
    );
    expect(unclassified).toEqual([]);
  });

  it("does not retain stale controller or safe-action registrations", () => {
    const actions = mutationActions();
    const actionKeys = new Set(
      actions.map(({ controller, handler }) => `${controller}.${handler}`)
    );
    const mutationControllers = new Set(actions.map(({ controller }) => controller));
    const staleControllers = Object.keys(OPERATIONAL_WRITE_CONTROLLER_MODULES).filter(
      (controller) => !mutationControllers.has(controller)
    );
    const staleAllowedActions = [...OPERATIONAL_WRITE_ALLOWED_ACTIONS].filter(
      (action) => !actionKeys.has(action)
    );
    expect(staleControllers).toEqual([]);
    expect(staleAllowedActions).toEqual([]);
  });
});
