export const COMMAND_CHARACTER_LIMIT = 20_000;
export const COMMAND_BOTS = ["Source", "Planner", "Timeline"];
export const SOURCE_AGENTS = ["source.work", "source.generate"];
export const TIMELINE_AGENTS = [
  "timeline.author",
  "timeline.captions",
  "timeline.graphics",
  "timeline.sound",
  "timeline.titles",
];

export const BOT_TOOL_IDS = {
  Source: ["transcribe", "detect_events", "detect_beats", "masking", "img2video", "voiceover"],
  Planner: [],
  Timeline: ["transcribe", "detect_events", "detect_beats", "masking"],
};

const SOURCE_AGENT_TOOL_IDS = {
  "source.work": ["transcribe", "detect_events", "detect_beats", "masking"],
  "source.generate": ["img2video", "voiceover", "masking"],
};

function defaultId() {
  return globalThis.crypto?.randomUUID?.() ?? `command-${Date.now()}-${Math.random()}`;
}

export function canonicalBot(value) {
  return COMMAND_BOTS.find((bot) => bot.toLowerCase() === String(value ?? "").toLowerCase()) ?? null;
}

export function canonicalSourceAgent(value) {
  return SOURCE_AGENTS.find((agent) => agent.toLowerCase() === String(value ?? "").toLowerCase()) ?? null;
}

export function canonicalTimelineAgent(value) {
  return TIMELINE_AGENTS.find((agent) => agent.toLowerCase() === String(value ?? "").toLowerCase()) ?? null;
}

function copyToolConfig(value, tools) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowed = new Set(tools);
  const entries = Object.entries(value)
    .filter(([tool, config]) => allowed.has(tool) && config && typeof config === "object" && !Array.isArray(config))
    .map(([tool, config]) => [tool, { ...config }]);
  return entries.length ? Object.fromEntries(entries) : null;
}

function allowedToolIds(bot, agent = null) {
  if (bot === "Source") {
    return SOURCE_AGENT_TOOL_IDS[canonicalSourceAgent(agent) ?? "source.work"];
  }
  return BOT_TOOL_IDS[bot] ?? [];
}

export function createCommand(command = {}, idFactory = defaultId) {
  const bot = canonicalBot(command.bot);
  const sourceAgent = bot === "Source" ? canonicalSourceAgent(command.agent) ?? "source.work" : null;
  const timelineAgent = bot === "Timeline" ? canonicalTimelineAgent(command.agent) : null;
  const agent = sourceAgent === "source.generate" ? sourceAgent : timelineAgent;
  const allowedTools = new Set(allowedToolIds(bot, sourceAgent));
  const tools = [...new Set(command.tools ?? [])].filter((tool) => allowedTools.has(tool));
  const toolConfig = copyToolConfig(command.toolConfig, tools);
  const generation = sourceAgent === "source.generate";
  const budgetUsd = Number(command.budgetUsd);
  const maxCalls = Number(command.maxCalls);
  return {
    id: command.id ?? idFactory(),
    bot,
    prompt: String(command.prompt ?? ""),
    tools,
    ...(agent ? { agent } : {}),
    ...(toolConfig ? { toolConfig } : {}),
    ...(generation && Number.isFinite(budgetUsd) && budgetUsd >= 0 ? { budgetUsd } : {}),
    ...(generation && Number.isInteger(maxCalls) && maxCalls >= 1 ? { maxCalls } : {}),
    ...(generation && String(command.name ?? "").trim() ? { name: String(command.name).trim() } : {}),
  };
}

export function addCommand(commands, command = {}, idFactory = defaultId) {
  return [...commands, createCommand(command, idFactory)];
}

export function removeCommand(commands, commandId, idFactory = defaultId) {
  const next = commands.filter((command) => command.id !== commandId);
  return next.length ? next : [createCommand({}, idFactory)];
}

export function moveCommand(commands, commandId, offset) {
  const index = commands.findIndex((command) => command.id === commandId);
  const destination = index + offset;
  if (index < 0 || destination < 0 || destination >= commands.length) return commands.slice();
  const next = commands.slice();
  [next[index], next[destination]] = [next[destination], next[index]];
  return next;
}

export function setCommandBot(commands, commandId, bot) {
  const canonical = canonicalBot(bot);
  return commands.map((command) => command.id === commandId
    ? createCommand({ ...command, bot: canonical, tools: canonical === command.bot ? command.tools : [] })
    : command);
}

export function toggleCommandTool(commands, commandId, tool) {
  return commands.map((command) => {
    if (command.id !== commandId || !allowedToolIds(command.bot, command.agent).includes(tool)) return command;
    const tools = command.tools.includes(tool)
      ? command.tools.filter((candidate) => candidate !== tool)
      : [...command.tools, tool];
    return { ...command, tools };
  });
}

const AGENT_LINE = /^[\t ]*@(Source|Planner|Timeline)\b[\t ]*(.*)$/gim;

/**
 * Turn textarea input into structured commands. With a fallback bot, text before
 * the first agent line remains the current command. Without one, the first agent
 * line must begin the input (apart from whitespace) to activate parsing.
 */
export function parseCommandText(value, { fallbackBot = null, idFactory = defaultId } = {}) {
  const text = String(value ?? "").replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const matches = [...text.matchAll(AGENT_LINE)];
  const canonicalFallback = canonicalBot(fallbackBot);
  if (matches.length === 0) {
    return { detected: false, commands: [createCommand({ bot: canonicalFallback, prompt: text }, idFactory)] };
  }

  const prefix = text.slice(0, matches[0].index);
  if (!canonicalFallback && prefix.trim()) {
    return { detected: false, commands: [createCommand({ prompt: text }, idFactory)] };
  }

  const commands = [];
  if (canonicalFallback && prefix.trim()) {
    commands.push(createCommand({ bot: canonicalFallback, prompt: prefix.replace(/\n$/, "") }, idFactory));
  }
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const nextIndex = matches[index + 1]?.index ?? text.length;
    const afterHeader = match.index + match[0].length;
    const continuation = text.slice(afterHeader, nextIndex).replace(/^\n/, "").replace(/\n$/, "");
    const prompt = [match[2], continuation].filter((part) => part !== "").join("\n");
    commands.push(createCommand({ bot: canonicalBot(match[1]), prompt }, idFactory));
  }

  return { detected: true, commands };
}

export function validateCommand(command, index = 0) {
  if (!canonicalBot(command.bot)) return `Command ${index + 1} needs @Source, @Planner, or @Timeline.`;
  if (!String(command.prompt ?? "").trim()) return `Write a prompt for command ${index + 1} (@${command.bot}).`;
  if (command.prompt.length > COMMAND_CHARACTER_LIMIT) {
    return `Command ${index + 1} is ${command.prompt.length.toLocaleString()} characters; the limit is ${COMMAND_CHARACTER_LIMIT.toLocaleString()}.`;
  }
  const allowed = new Set(allowedToolIds(command.bot, command.agent));
  if (command.tools.some((tool) => !allowed.has(tool))) return `Command ${index + 1} has a tool that @${command.bot} cannot use.`;
  return null;
}

export function validateCommands(commands) {
  if (!commands.length) return ["Add a command before running the workflow."];
  return commands.map(validateCommand).filter(Boolean);
}

export function validCommandCount(commands) {
  return commands.filter((command, index) => !validateCommand(command, index)).length;
}

export function commandToolSummary(command, labelFor = (tool) => tool) {
  if (command.bot === "Planner") return "Tools: none · session context automatic";
  if (!command.tools.length) return "Tools: none";
  return `Tools: ${command.tools.map(labelFor).join(", ")}`;
}

export function composerCopy(commands) {
  const validCount = validCommandCount(commands);
  return {
    button: validCount >= 2 ? `Run ${validCount}-command workflow` : "Send",
    helpTitle: commands.length >= 2 ? "How command chains work" : "How to chat",
    helpText: commands.length >= 2
      ? "Commands run top to bottom. Each waits for the previous command and uses the latest session and edit context."
      : "Start with an @mention, choose tools, then write the prompt.",
  };
}

export function buildTurnBody(command, { editId = null, requestId }) {
  if (command.bot === "Planner") {
    return { requestId: requestId("planner"), mode: "ask", message: command.prompt.trim() };
  }
  const sourceAgent = command.bot === "Source" ? canonicalSourceAgent(command.agent) ?? "source.work" : null;
  const generation = sourceAgent === "source.generate";
  const toolConfig = copyToolConfig(command.toolConfig, command.tools);
  return {
    requestId: requestId(command.bot.toLowerCase()),
    mode: "edit",
    agent: sourceAgent ?? canonicalTimelineAgent(command.agent) ?? "timeline.author",
    message: command.prompt.trim(),
    ...(command.bot === "Timeline" && editId ? { baseEditId: editId } : {}),
    ...(command.tools.length ? { tools: command.tools.slice() } : {}),
    ...(toolConfig ? { toolConfig } : {}),
    ...(generation && command.budgetUsd !== undefined ? { budgetUsd: command.budgetUsd } : {}),
    ...(generation && command.maxCalls !== undefined ? { maxCalls: command.maxCalls } : {}),
    ...(generation && command.name ? { name: command.name } : {}),
  };
}

function errorDetails(error) {
  return {
    message: error?.message ?? String(error),
    code: error?.code,
    retryable: Boolean(error?.retryable),
  };
}

export class CommandWorkflow {
  constructor(commands, { executeStep, initialEditId = null, onChange = () => {} } = {}) {
    if (typeof executeStep !== "function") throw new TypeError("executeStep is required");
    this.commands = commands.map((command) => createCommand(command));
    this.steps = this.commands.map((command) => ({ command, status: "Waiting", progress: "", result: null, error: null }));
    this.executeStep = executeStep;
    this.editId = initialEditId;
    this.currentIndex = 0;
    this.paused = false;
    this.stopped = false;
    this.running = false;
    this.onChange = onChange;
  }

  snapshot() {
    return {
      currentIndex: this.currentIndex,
      editId: this.editId,
      paused: this.paused,
      stopped: this.stopped,
      running: this.running,
      steps: this.steps.map((step) => ({
        command: {
          ...step.command,
          tools: step.command.tools.slice(),
          ...(step.command.toolConfig ? { toolConfig: copyToolConfig(step.command.toolConfig, step.command.tools) } : {}),
        },
        status: step.status,
        progress: step.progress,
        result: step.result,
        error: step.error,
      })),
    };
  }

  emit() {
    this.onChange(this.snapshot());
  }

  setProgress(index, progress) {
    if (this.steps[index]?.status !== "Running") return;
    this.steps[index].progress = progress;
    this.emit();
  }

  async run() {
    if (this.running || this.stopped || this.paused) return this.snapshot();
    this.running = true;
    this.emit();
    while (this.currentIndex < this.steps.length && !this.stopped) {
      const index = this.currentIndex;
      const step = this.steps[index];
      step.status = "Running";
      step.progress = "Sending request…";
      step.error = null;
      this.emit();
      try {
        const result = await this.executeStep(step.command, {
          index,
          editId: this.editId,
          setProgress: (progress) => this.setProgress(index, progress),
        });
        step.status = "Complete";
        step.progress = "Complete";
        step.result = result;
        if (result?.type === "edit" && result.editId) this.editId = result.editId;
        this.currentIndex += 1;
        this.emit();
      } catch (error) {
        step.status = "Failed";
        step.progress = error?.message ?? String(error);
        step.error = errorDetails(error);
        this.paused = true;
        this.emit();
        break;
      }
    }
    this.running = false;
    this.emit();
    return this.snapshot();
  }

  async retry() {
    if (!this.paused || this.stopped || this.running) return this.snapshot();
    const step = this.steps[this.currentIndex];
    if (step) {
      step.status = "Waiting";
      step.progress = "";
      step.error = null;
    }
    this.paused = false;
    this.emit();
    return this.run();
  }

  stop() {
    if (this.running) return false;
    this.stopped = true;
    this.paused = false;
    this.emit();
    return true;
  }

  remainingCommands() {
    return this.steps.slice(this.currentIndex).map((step) => createCommand(step.command));
  }
}
