import ts from 'typescript';
import { expandType } from './server/dev/typeMap/tsProgram';

const sourceCode = `
  export interface ApiParams {
    data: { createdAt: Date; extra: Promise<number> };
  }
`;

const sourceFile = ts.createSourceFile('test.ts', sourceCode, ts.ScriptTarget.Latest, true);
const host: ts.CompilerHost = {
  ...ts.createCompilerHost({}),
  getSourceFile: (fileName) => (fileName === 'test.ts' ? sourceFile : undefined),
};

const program = ts.createProgram(['test.ts'], {}, host);
const checker = program.getTypeChecker();

const paramsIntf = sourceFile.statements[0] as ts.InterfaceDeclaration;
const dataProp = paramsIntf.members[0] as ts.PropertySignature;
const type = checker.getTypeFromTypeNode(dataProp.type!);

console.log('expanded:', expandType(type, checker));
