import chalk from "chalk";

/**
 * Beautiful CLI utilities with detailed output
 */

const colors = {
  heading: (text: string) => chalk.bold.cyan(text),
  section: (text: string) => chalk.bold.white(text),
  subsection: (text: string) => chalk.cyan(text),
  success: (text: string) => chalk.green(text),
  status: (text: string) => chalk.gray(text),
  number: (text: string) => chalk.bold.yellow(text),
  highlight: (text: string) => chalk.bold.white(text),
  muted: (text: string) => chalk.dim.gray(text),
  error: (text: string) => chalk.red(text),
  secondary: (text: string) => chalk.gray(text),
};

// Spinner animation frames
const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerFrame = 0;
let spinnerInterval: NodeJS.Timeout | null = null;
let spinnerText = "";

/**
 * Start an animated spinner
 */
export function startSpinner(text: string) {
  spinnerText = text;
  spinnerFrame = 0;

  spinnerInterval = setInterval(() => {
    const frame = spinnerFrames[spinnerFrame % spinnerFrames.length];
    const line = `    ${colors.subsection(frame)} ${text}`;
    process.stdout.write(`\r${line.padEnd(80)}\r`);
    spinnerFrame++;
  }, 80);
}

/**
 * Stop the spinner and clear the line
 */
export function stopSpinner() {
  if (spinnerInterval) {
    clearInterval(spinnerInterval);
    spinnerInterval = null;
  }
  process.stdout.write("\r" + " ".repeat(100) + "\r");
}

export function printHeader(title: string, subtitle: string) {
  console.log("");
  console.log(colors.heading(`  ╭─ ${title}`));
  console.log(colors.muted(`  ╰─ ${subtitle}`));
  console.log("");
}

export function printStageStart(stageName: string) {
  console.log("");
  console.log(colors.section(`  ▸ ${stageName}`));
}

export function printProgress(current: number, total: number, context?: string) {
  const percent = Math.round((current / total) * 100);
  const bar = createProgressBar(percent);
  const status = `${colors.number(current.toString())}/${colors.muted(total.toString())}`;
  const ctx = context ? ` ${colors.muted(context)}` : "";
  const line = `    ${bar} ${status}${ctx}`;
  process.stdout.write(`\r${line.padEnd(90)}`);
}

export function printProgressDone() {
  process.stdout.write("\n");
}

function createProgressBar(percent: number, width: number = 20): string {
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  const filledPart = colors.success("█".repeat(filled));
  const emptyPart = colors.muted("░".repeat(empty));
  return `[${filledPart}${emptyPart}]`;
}

export function printResult(
  label: string,
  count: number,
  total?: number,
  details?: string
) {
  const countStr = total
    ? `${colors.number(count.toString())} ${colors.muted(`/ ${total}`)}`
    : colors.number(count.toString());
  const detail = details ? ` ${colors.muted(`(${details})`)}` : "";
  console.log(`    ${colors.success("✓")} ${label} ${countStr}${detail}`);
}

export function printSummaryLine(label: string, value: string | number) {
  const formattedValue = typeof value === "number" ? colors.number(String(value)) : value;
  const paddedLabel = label.padEnd(24);
  console.log(`    ${colors.secondary(paddedLabel)} ${formattedValue}`);
}

export function printSelection(items: string[], limit: number = 5) {
  items.slice(0, limit).forEach((item, i) => {
    console.log(`    ${colors.secondary(`${(i + 1).toString().padStart(2)}.`)} ${item}`);
  });
  if (items.length > limit) {
    console.log(`    ${colors.muted(`... and ${items.length - limit} more`)}`);
  }
  console.log("");
}

export function printError(message: string) {
  console.error(`\n  ${colors.error("✘ " + message)}\n`);
}

export function printCompletion(stats: {
  feeds: number;
  raw: number;
  selected: number;
  researched: number;
  trends: number;
  concepts: number;
  drafts: number;
  calls: number;
  failed: number;
  duration: string;
  cost?: number;
  outputDir?: string;
}) {
  const boxWidth = getCompletionBoxWidth();
  const title = "─ PIPELINE COMPLETE ";
  const topFill = Math.max(0, boxWidth - title.length);

  console.log("");
  console.log(colors.section(`  ╭${title}${"─".repeat(topFill)}╮`));
  printBoxEmpty(boxWidth);

  printBoxHeader("Metrics", boxWidth);
  printBoxDivider(boxWidth);
  printBoxStat("Feeds scanned", stats.feeds, boxWidth);
  printBoxStat("Raw items fetched", stats.raw, boxWidth);
  printBoxStat("Items selected", stats.selected, boxWidth);
  printBoxStat("Articles researched", stats.researched, boxWidth);
  printBoxStat("Trends identified", stats.trends, boxWidth);
  printBoxStat("Content concepts", stats.concepts, boxWidth);
  printBoxStat("Drafts generated", stats.drafts, boxWidth);

  printBoxDivider(boxWidth);
  printBoxHeader("API Usage", boxWidth);
  printBoxDivider(boxWidth);
  printBoxStat("Total LLM calls", stats.calls, boxWidth);
  if (stats.failed > 0) {
    printBoxStat("Failed calls", stats.failed, boxWidth, true);
  }
  if (stats.cost !== undefined) {
    const costStr = `$${stats.cost.toFixed(4)}`;
    printBoxStatStr("Estimated cost", costStr, boxWidth);
  }

  printBoxDivider(boxWidth);
  printBoxHeader("Duration", boxWidth);
  printBoxDivider(boxWidth);
  printBoxValue(stats.duration, boxWidth);

  if (stats.outputDir) {
    printBoxDivider(boxWidth);
    printBoxHeader("Output", boxWidth);
    printBoxDivider(boxWidth);
    const outputPath = stats.outputDir.replace(process.cwd(), ".");
    printBoxStatStr("Directory", outputPath, boxWidth);
  }

  printBoxEmpty(boxWidth);
  console.log(colors.section(`  ╰${"─".repeat(boxWidth)}╯`));
  console.log("");
}

function printBoxEmpty(width: number) {
  console.log(colors.section("  │") + " ".repeat(width) + colors.section("│"));
}

function printBoxDivider(width: number) {
  console.log(colors.section("  │") + colors.muted("  " + "─".repeat(width - 2)) + colors.section("│"));
}

function printBoxHeader(title: string, width: number) {
  const left = `  ${title}`;
  const row = left.padEnd(width, " ");
  console.log(colors.section("  │") + colors.subsection(row) + colors.section("│"));
}

function printBoxStat(label: string, value: number, width: number, isError = false) {
  const icon = isError ? colors.error("✘") : colors.success("✓");
  const leftPlain = `    ${isError ? "✘" : "✓"} ${label}`;
  const rightPlain = String(value);
  const gap = Math.max(1, width - leftPlain.length - rightPlain.length - 2);
  const row = `    ${icon} ${isError ? colors.error(label) : label}${" ".repeat(gap)}${colors.number(rightPlain)}`;
  console.log(colors.section("  │") + row + "  " + colors.section("│"));
}

function printBoxStatStr(label: string, value: string, width: number) {
  const leftPlain = `    ✓ ${label}`;
  const rightPlain = value;
  const gap = Math.max(1, width - leftPlain.length - rightPlain.length - 2);
  const row = `    ${colors.success("✓")} ${label}${" ".repeat(gap)}${colors.number(rightPlain)}`;
  console.log(colors.section("  │") + row + "  " + colors.section("│"));
}

function printBoxValue(value: string, width: number) {
  const text = colors.number(value);
  const leftPad = Math.max(0, Math.floor((width - value.length) / 2));
  const rightPad = Math.max(0, width - leftPad - value.length);
  console.log(colors.section("  │") + " ".repeat(leftPad) + text + " ".repeat(rightPad) + colors.section("│"));
}

function getCompletionBoxWidth(): number {
  const terminalCols = process.stdout.columns ?? 80;
  const minWidth = 48;
  const maxWidth = 68;
  const horizontalPadding = 4;
  const target = terminalCols - horizontalPadding;
  return Math.max(minWidth, Math.min(maxWidth, target));
}

export function printSection(title: string) {
  console.log("");
  console.log(colors.subsection(`  ◆ ${title}`));
}

export function printMessage(text: string, level: "info" | "success" | "muted" = "info") {
  const styled =
    level === "success" ? colors.success(text) : level === "muted" ? colors.muted(text) : text;
  console.log(`    ${styled}`);
}

export function clearLine() {
  process.stdout.write("\r" + " ".repeat(100) + "\r");
}
