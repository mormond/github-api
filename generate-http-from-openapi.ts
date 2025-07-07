import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'yaml';

const inputFile = 'ghec.2022-11-28.yaml';
const outputDir = './generated-http';

function methodToColor(method: string) {
  switch (method.toUpperCase()) {
    case 'GET': return '#36a64f';
    case 'POST': return '#007acc';
    case 'PUT': return '#ffb100';
    case 'PATCH': return '#b36ae2';
    case 'DELETE': return '#e74c3c';
    default: return '#cccccc';
  }
}

function sanitizeTag(tag: string) {
  return tag.replace(/[^\w\-]/g, '_');
}

function sanitizeVarName(name: string) {
  return name.replace(/[^\w]/g, '_').toUpperCase();
}

function main() {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

  const doc = yaml.parse(fs.readFileSync(inputFile, 'utf8'));
  const paths = doc.paths || doc;
  const envVars = new Set<string>(['BASE_URL', 'GH_TOKEN']);
  const tagGroups: Record<string, string[]> = {};

  for (const [route, methods] of Object.entries(paths)) {
    for (const [method, op] of Object.entries(methods as Record<string, any>)) {
      if (!op.tags || !Array.isArray(op.tags)) continue;
      // collect both path-level and operation-level parameters
      const pathLevelParams = Array.isArray((methods as any).parameters) ? (methods as any).parameters : [];
      const operationParams = Array.isArray(op.parameters) ? op.parameters : [];
      const params = [...pathLevelParams, ...operationParams];
      let url = route;
      // replace any path placeholders not defined in parameters (e.g., {owner}, {repo})
      Array.from(new Set(Array.from(route.matchAll(/\{([^}]+)\}/g), m => m[1]))).forEach(name => {
        const varName = sanitizeVarName(name);
        envVars.add(varName);
        url = url.replace(new RegExp(`\\{${name}\\}`, 'g'), `{{$dotenv ${varName}}}`);
      });
      const queryPairs: string[] = [];
      const headerLines: string[] = [];
      params.forEach((p: any) => {
        if (typeof p.name !== 'string') return;
        const varName = sanitizeVarName(p.name);
        envVars.add(varName);
        if (p.in === 'path') {
          url = url.replace(new RegExp(`\\{${p.name}\\}`, 'g'), `{{$dotenv ${varName}}}`);
        } else if (p.in === 'query') {
          queryPairs.push(`${p.name}={{$dotenv ${varName}}}`);
        } else if (p.in === 'header') {
          headerLines.push(`${p.name}: {{$dotenv ${varName}}}`);
        }
      });
      if (queryPairs.length) {
        url += (url.includes('?') ? '&' : '?') + queryPairs.join('&');
      }
      for (const tag of op.tags) {
        if (!tagGroups[tag]) tagGroups[tag] = [];
        const lines: string[] = [];
        lines.push(`### ${op.summary || ''} [${method.toUpperCase()}]`);
        lines.push(`${method.toUpperCase()} {{$dotenv BASE_URL}}${url}`);
        lines.push(`Authorization: Bearer {{$dotenv GH_TOKEN}}`);
        if (headerLines.length) lines.push(...headerLines);
        if (op.requestBody) {
          lines.push('Content-Type: application/json');
          lines.push(JSON.stringify(op.requestBody.example || {}, null, 2));
        }
        const req = lines.join('\n');
        tagGroups[tag].push(req);
      }
    }
  }

  for (const [tag, requests] of Object.entries(tagGroups)) {
    const file = path.join(outputDir, `${sanitizeTag(tag)}.http`);
    const header = `# Requests for tag: ${tag}\n\n\n\n`;
    fs.writeFileSync(file, header + requests.join('\n\n'));
    console.log(`Generated: ${file}`);
  }
  // write environment file
  const envContent = Array.from(envVars).map(v => `${v}=`).join('\n') + '\n';
  fs.writeFileSync(path.join(outputDir, '.env'), envContent);
  console.log(`Generated: ${path.join(outputDir, '.env')}`);
}

main();