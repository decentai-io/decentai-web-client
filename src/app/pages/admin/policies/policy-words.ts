import { CatalogAction } from 'src/app/services/auth.service';
import { PolicyStatement } from 'src/app/services/policy.service';

/**
 * A policy's statements said in words, for the Policies page: "Allows
 * See the organization's people; everything in Secrets". An action is
 * named by what the API server says of it; a service by its plain name;
 * an agent's action by the agent's and its function's names. What no
 * word stands for is shown as written.
 */

/** The services, by the first two parts of their actions. */
const SERVICES: Record<string, string> = {
  'account:profile': 'Your profile',
  'agents:agent': 'Agents',
  'agents:monitor': 'Agent monitoring',
  'agents:package': 'Agent programs',
  'ai:activity': 'Activity',
  'ai:approval': 'Approvals',
  'ai:audit': 'Audit',
  'ai:chat': 'Chats',
  'ai:event': 'Chat events',
  'ai:message': 'Messages',
  'ai:network': 'Chat network',
  'ai:output': 'Outputs',
  'ai:process': 'Chat processes',
  'ai:runtime': 'Runtimes',
  'ai:schedule': 'Schedules',
  'ai:state': 'Chat state',
  'ai:switch': 'The work switch',
  'ai:usage': 'Usage',
  'ai:use': 'Chat use',
  'auth:join': 'Joining',
  'auth:me': 'Your session',
  'auth:password': 'Passwords',
  'auth:session': 'Sessions',
  'data:record': 'Records',
  'files:file': 'Files',
  'files:piece': 'File uploads',
  'iam:group': 'Groups',
  'iam:invitation': 'Invitations',
  'iam:organization': 'Organizations',
  'iam:policy': 'Policies',
  'iam:user': 'People',
  'mcp:server': 'MCP servers',
  'nodes:authority': 'Node certificates',
  'nodes:node': 'Nodes',
  'records:record': 'Agents\' records',
  'secrets:oauth': 'Connected accounts',
  'secrets:secret': 'Secrets',
  'settings:apikey': 'API keys',
  'settings:llm': 'Models',
  'settings:memory': 'Memory',
  'settings:notifications': 'Notifications',
  'settings:oauth': 'Sign-in providers',
  'settings:organization': 'Organization settings',
  'settings:outbound': 'Outbound mail',
  'settings:speech': 'Speech',
  'settings:webhook': 'Webhooks',
  'skills:skill': 'Skills',
};

/** The areas, by the first part of their actions. */
const AREAS: Record<string, string> = {
  account: 'Your account', agents: 'Agents', ai: 'Chats', auth: 'Signing in', data: 'Records', files: 'Files',
  iam: 'People and access', mcp: 'MCP servers', nodes: 'Nodes', records: 'Records', secrets: 'Secrets',
  settings: 'Settings', skills: 'Skills',
};

function capitalised(words: string): string {
  const plain = words.replace(/_/g, ' ').trim();
  return plain ? plain.charAt(0).toUpperCase() + plain.slice(1) : '';
}

/** A service's plain name: "iam:user" is People. */
export function serviceName(key: string): string {
  if (SERVICES[key]) return SERVICES[key];
  const [area, service] = key.split(':');
  return service ? capitalised(service) : AREAS[area] || capitalised(area);
}

/** An installed agent, as its actions are named. */
export interface NamedAgent {
  agent_id: string;
  name: string;
  functions: { id: string; name: string }[];
}

/** Says actions and statements in words, against the catalog and the
 *  installed agents. */
export class PolicyWords {
  private words: Map<string, string>;
  private agents: Map<string, NamedAgent>;

  constructor(catalog: CatalogAction[], agents: NamedAgent[]) {
    this.words = new Map(catalog.map(({ action, words }) => [action, words]));
    this.agents = new Map(agents.map((agent) => [agent.agent_id, agent]));
  }

  agentName(agentId: string): string {
    return this.agents.get(agentId)?.name || capitalised(agentId);
  }

  /** One action, or a pattern of them, in words. */
  action(action: string): string {
    if (action === '*') return 'Everything';
    if (action.startsWith('agent:')) return this.agentAction(action);
    const parts = action.split(':');
    if (parts.length === 2 && parts[1] === '*') return `Everything in ${AREAS[parts[0]] || capitalised(parts[0])}`;
    if (parts.length === 3 && parts[2] === '*') return `Everything in ${serviceName(parts.slice(0, 2).join(':'))}`;
    const said = this.words.get(action);
    if (said) return said;
    if (parts.length === 3 && !action.includes('*')) {
      return `${serviceName(parts.slice(0, 2).join(':'))}: ${parts[2].replace(/_/g, ' ')}`;
    }
    return action;
  }

  /** `agent:<agent>:<function>[:<call>]`, and their patterns. */
  private agentAction(action: string): string {
    const [, agentId = '', fn = '', ...call] = action.split(':');
    if (!agentId || agentId.includes('*')) return action;
    const agent = this.agentName(agentId);
    if (!fn || fn === '*') return `All of ${agent}`;
    const fnName = this.agents.get(agentId)?.functions.find((each) => each.id === fn)?.name || fn.replace(/_/g, ' ');
    if (fn.includes('*')) return `${agent}: ${fn}`;
    if (!call.length) return `${agent}: ${fnName}`;
    const calls = call.join(':');
    return calls === '*' ? `${agent}: what ${fnName} calls` : `${agent}: ${fnName}, calling ${calls}`;
  }

  /** The verb a statement starts with. */
  effect(statement: PolicyStatement): string {
    return statement.effect === 'allow' ? 'Allows' : statement.effect === 'ask' ? 'Asks first for' : 'Doesn\'t allow';
  }

  /** "only where mailbox is work or personal"; '' without scopes. */
  scopes(statement: PolicyStatement): string {
    const narrowed = Object.entries(statement.scopes || {}).filter(([, values]) => values?.length);
    if (!narrowed.length) return '';
    const said = narrowed.map(([name, values]) => {
      const listed = values.length > 1 ? `${values.slice(0, -1).join(', ')} or ${values[values.length - 1]}` : values[0];
      return `${name} is ${listed}`;
    });
    return `only where ${said.join(' and ')}`;
  }

  /** The agents a statement names, by id. */
  static agentsOf(statements: PolicyStatement[]): string[] {
    const ids = statements.flatMap((statement) => statement.actions)
      .filter((action) => action.startsWith('agent:'))
      .map((action) => action.split(':')[1] || '')
      .filter((id) => id && !id.includes('*'));
    return [...new Set(ids)];
  }
}
