import katex from "katex";
import { useEffect, useId, useRef, useState } from "react";
import type { MouseEvent } from "react";
import type {
  CodeBlockComponentProps,
  CodexMarkdownComponents,
  HighlighterResult,
  MathComponentProps,
  MermaidComponentProps,
} from "../types";
import { WIDE_BLOCK_CLASS_NAME } from "../classNames";

export const runtimeBlockComponents: Pick<
  CodexMarkdownComponents,
  "codeBlock" | "math" | "mermaid"
> = {
  codeBlock(props) {
    return <CodeBlock {...props} />;
  },

  mermaid(props) {
    return <MermaidDiagram {...props} />;
  },

  math(props) {
    return <MathRenderer {...props} />;
  },
};

function CodeBlock({ node, highlighter, className }: CodeBlockComponentProps) {
  const language = node.type === "mermaid" ? "mermaid" : node.language;
  const value = node.value;
  const [highlighted, setHighlighted] = useState<HighlighterResult | null>(null);
  const [highlightError, setHighlightError] = useState(false);
  const codeClassName = ["codex-md-code-code whitespace-pre!", highlighted?.className].filter(Boolean).join(" ");

  useEffect(() => {
    let cancelled = false;
    const clearScheduled = scheduleHighlight(() => {
      Promise.resolve(highlighter?.(value, language) ?? null)
        .then((result) => {
          if (cancelled) {
            return;
          }
          setHighlighted(result);
          setHighlightError(false);
        })
        .catch(() => {
          if (cancelled) {
            return;
          }
          setHighlighted(null);
          setHighlightError(true);
        });
    });

    return () => {
      cancelled = true;
      clearScheduled();
    };
  }, [highlighter, language, value]);

  return (
    <div className={["codex-md-code-block relative w-full min-w-0 overflow-clip rounded-lg border contain-inline-size bg-token-text-code-block-background border-token-input-background light my-2", className].filter(Boolean).join(" ")} data-theme="light">
      <div className="codex-md-code-header flex items-center text-sm font-sans text-token-description-foreground select-none ps-2 pe-2 py-1 rounded-t-lg">
        <div className="codex-md-code-language min-w-0 flex-1 truncate">{language ?? "text"}</div>
        <div className="codex-md-code-actions ml-auto flex shrink-0 items-center">
          <div className="codex-md-code-action-group flex items-center gap-px">
            <span className="codex-md-code-action-tooltip contents" data-state="closed">
              <CopyButton
                ariaLabel="复制"
                copiedAriaLabel="已复制"
                className="codex-md-copy-button border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-md text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent justify-center p-1 [&>svg]:icon-sm"
                iconSize="xs"
                onCopy={() => copyText(value)}
              />
            </span>
          </div>
        </div>
      </div>
      <div className="codex-md-code-body text-size-chat overflow-auto p-2" dir="ltr">
        {!highlightError && highlighted?.html ? (
          <code
            className={codeClassName}
            dangerouslySetInnerHTML={{ __html: highlighted.html }}
          />
        ) : (
          <code className="codex-md-code-code whitespace-pre!">{value}</code>
        )}
      </div>
    </div>
  );
}

function scheduleHighlight(work: () => void): () => void {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(() => {
      work();
    });
    return () => window.cancelIdleCallback(handle);
  }

  const timeoutId = window.setTimeout(work, 0);
  return () => window.clearTimeout(timeoutId);
}

function MathRenderer({ node, throwOnError }: MathComponentProps) {
  try {
    const html = katex.renderToString(node.value, {
      displayMode: node.display,
      strict: "ignore",
      throwOnError: throwOnError ?? false,
    });
    const Tag = node.display ? "div" : "span";
    return (
      <Tag
        className={node.display ? "codex-md-math codex-md-math-display" : "codex-md-math"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return (
      <code className={node.display ? "codex-md-math codex-md-math-display" : "codex-md-math"}>
        {node.value}
      </code>
    );
  }
}

function MermaidDiagram({ node, config, theme }: MermaidComponentProps) {
  const id = useStableMermaidId();
  const diagramRef = useRef<HTMLDivElement | null>(null);
  const [renderState, setRenderState] = useState<"loading" | "rendered" | "error">("loading");
  const [actualSize, setActualSize] = useState(false);
  const sanitizedCode = sanitizeMermaidCode(node.value);
  const diagramKind = getMermaidDiagramKind(sanitizedCode);

  useEffect(() => {
    let cancelled = false;
    const target = diagramRef.current;
    if (target == null || sanitizedCode == null) {
      setRenderState("error");
      return;
    }

    target.innerHTML = "";
    setRenderState("loading");

    import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          darkMode: theme === "dark",
          deterministicIds: true,
          deterministicIDSeed: "codex-mermaid",
          flowchart: { htmlLabels: false },
          fontFamily: "var(--font-sans)",
          htmlLabels: false,
          startOnLoad: false,
          suppressErrorRendering: true,
          securityLevel: "strict",
          theme: "base",
          themeVariables: getMermaidThemeVariables(target),
          ...config,
        });
        return mermaid.parse(sanitizedCode, { suppressErrors: true }).then((valid) => {
          if (valid === false) throw new Error("Invalid Mermaid diagram");
          return mermaid.render(id, sanitizedCode);
        });
      })
      .then(({ svg }) => {
        if (cancelled) return;
        renderMermaidSvg(target, svg, node.value, actualSize);
        target.setAttribute("data-mermaid-theme", "base");
        if (diagramKind == null) {
          target.removeAttribute("data-mermaid-diagram");
        } else {
          target.setAttribute("data-mermaid-diagram", diagramKind);
        }
        setRenderState("rendered");
      })
      .catch(() => {
        if (cancelled) return;
        target.innerHTML = "";
        setRenderState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [actualSize, config, diagramKind, id, node.value, sanitizedCode, theme]);

  const toggleActualSize = () => {
    setActualSize((current) => !current);
  };

  if (renderState === "error") {
    return (
      <div className={WIDE_BLOCK_CLASS_NAME} data-wide-markdown-block="true" data-wide-markdown-block-kind="mermaid">
        <CodeBlock node={{ type: "codeBlock", value: node.value, language: "mermaid" }} />
      </div>
    );
  }

  return (
    <div className={WIDE_BLOCK_CLASS_NAME} data-wide-markdown-block="true" data-wide-markdown-block-kind="mermaid">
      <div className="codex-md-mermaid-frame">
        <div className="codex-md-mermaid-toolbar">
          <span className="codex-md-code-action-tooltip" data-state="closed">
            <button
              aria-label={actualSize ? "调整图表适应宽度" : "查看实际大小"}
              aria-pressed={actualSize}
              className="codex-md-icon-button border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-md text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent justify-center p-1 [&>svg]:icon-sm"
              data-active={actualSize ? "true" : undefined}
              onClick={toggleActualSize}
              type="button"
            >
              {actualSize ? <FitWidthIcon /> : <ActualSizeIcon />}
            </button>
          </span>
          <span className="codex-md-code-action-tooltip" data-state="closed">
            <CopyButton
              ariaLabel="复制"
              copiedAriaLabel="已复制"
              className="codex-md-icon-button border-token-border user-select-none no-drag cursor-interaction flex items-center gap-1 border whitespace-nowrap focus:outline-none disabled:cursor-not-allowed disabled:opacity-40 rounded-md text-token-text-tertiary enabled:hover:bg-token-list-hover-background data-[state=open]:bg-token-list-hover-background border-transparent justify-center p-1 [&>svg]:icon-sm"
              iconSize="2xs"
              onCopy={() => copyText(["```mermaid", node.value, "```"].join("\n"))}
            />
          </span>
        </div>
        <div
          aria-label="Mermaid 流程图"
          className={actualSize ? "codex-md-mermaid-diagram codex-md-mermaid-diagram-actual" : "codex-md-mermaid-diagram"}
          ref={diagramRef}
          role="img"
        />
      </div>
    </div>
  );
}

function CopyIcon({ size = "xs" }: { size?: "xs" | "2xs" }) {
  return (
    <svg
      aria-hidden="true"
      className={size === "xs" ? "codex-md-copy-icon codex-md-icon-xs" : "codex-md-copy-icon codex-md-icon-2xs"}
      fill="none"
      height="21"
      viewBox="0 0 21 21"
      width="21"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M13.468 11.1216C13.468 10.4107 13.468 9.91717 13.4367 9.53369C13.4137 9.25191 13.3758 9.0622 13.3244 8.91846L13.2687 8.78858C13.1148 8.48652 12.8803 8.23344 12.593 8.05713L12.466 7.98584C12.308 7.90546 12.0963 7.84854 11.7209 7.81787C11.3374 7.78656 10.8439 7.78662 10.133 7.78662H7.29999C6.58895 7.78662 6.09562 7.78654 5.7121 7.81787C5.43015 7.84091 5.24064 7.87872 5.09686 7.93018L4.96698 7.98584C4.66487 8.13977 4.41184 8.37419 4.23554 8.66162L4.16522 8.78858C4.08477 8.94657 4.02794 9.15811 3.99725 9.53369C3.96594 9.91718 3.96503 10.4107 3.96503 11.1216V13.9546C3.96503 14.6656 3.96592 15.159 3.99725 15.5425C4.02796 15.9182 4.08471 16.1296 4.16522 16.2876L4.23554 16.4136C4.41185 16.7012 4.66472 16.9353 4.96698 17.0894L5.09686 17.146C5.24061 17.1974 5.43024 17.2343 5.7121 17.2573C6.09562 17.2887 6.58895 17.2896 7.29999 17.2896H10.133C10.8439 17.2896 11.3374 17.2886 11.7209 17.2573C12.0965 17.2266 12.308 17.1698 12.466 17.0894L12.593 17.019C12.8804 16.8427 13.1148 16.5897 13.2687 16.2876L13.3244 16.1577C13.3759 16.0139 13.4137 15.8244 13.4367 15.5425C13.468 15.159 13.468 14.6656 13.468 13.9546V11.1216ZM14.798 13.1196C15.2528 13.118 15.6011 13.1147 15.8879 13.0913C16.2634 13.0606 16.475 13.0038 16.633 12.9233L16.759 12.8521C17.0466 12.6757 17.2808 12.4228 17.4348 12.1206L17.4914 11.9907C17.5428 11.847 17.5797 11.6572 17.6027 11.3755C17.634 10.992 17.6349 10.4985 17.6349 9.7876V6.95459C17.6349 6.24355 17.6341 5.75022 17.6027 5.3667C17.5797 5.08484 17.5428 4.89522 17.4914 4.75147L17.4348 4.62158C17.2807 4.31933 17.0466 4.06645 16.759 3.89014L16.633 3.81982C16.475 3.73932 16.2636 3.68256 15.8879 3.65186C15.5044 3.62052 15.011 3.61963 14.3 3.61963H11.467C10.7561 3.61963 10.2626 3.62054 9.87909 3.65186C9.59738 3.67487 9.40759 3.71179 9.26386 3.76318L9.13397 3.81982C8.83175 3.97382 8.57885 4.20802 8.40253 4.49561L8.33124 4.62158C8.25079 4.77957 8.19396 4.99114 8.16327 5.3667C8.13984 5.65352 8.13561 6.00178 8.13397 6.45654H10.133C10.822 6.45654 11.3791 6.4559 11.8293 6.49268C12.2873 6.5301 12.6937 6.6093 13.0705 6.80127L13.2883 6.92334C13.7839 7.22739 14.1878 7.66313 14.4533 8.18408L14.5197 8.32666C14.6642 8.66318 14.7291 9.02433 14.7619 9.42529C14.7987 9.8755 14.798 10.4326 14.798 11.1216V13.1196ZM18.965 9.7876C18.965 10.4766 18.9657 11.0337 18.9289 11.4839C18.8961 11.8848 18.8311 12.246 18.6867 12.5825L18.6203 12.7251C18.3548 13.246 17.9509 13.6818 17.4553 13.9858L17.2365 14.1079C16.8599 14.2998 16.4541 14.3791 15.9963 14.4165C15.6592 14.444 15.2624 14.4481 14.7951 14.4497C14.7935 14.917 14.7894 15.3138 14.7619 15.6509C14.7292 16.0516 14.664 16.4122 14.5197 16.7485L14.4533 16.8911C14.1878 17.4122 13.7841 17.8487 13.2883 18.1528L13.0705 18.2749C12.6937 18.4669 12.2873 18.5461 11.8293 18.5835C11.3791 18.6203 10.822 18.6196 10.133 18.6196H7.29999C6.6109 18.6196 6.05394 18.6203 5.6037 18.5835C5.20305 18.5508 4.84233 18.4855 4.50604 18.3413L4.36347 18.2749C3.84243 18.0094 3.40584 17.6056 3.10175 17.1099L2.97968 16.8911C2.78787 16.5145 2.70849 16.1087 2.67108 15.6509C2.6343 15.2006 2.63495 14.6437 2.63495 13.9546V11.1216C2.63495 10.4326 2.63431 9.8755 2.67108 9.42529C2.7085 8.96729 2.78771 8.56084 2.97968 8.18408L3.10175 7.96631C3.40585 7.47049 3.84235 7.06679 4.36347 6.80127L4.50604 6.73486C4.84236 6.59059 5.20302 6.52542 5.6037 6.49268C5.9405 6.46516 6.33707 6.4601 6.80389 6.4585C6.8055 5.99167 6.81056 5.5951 6.83807 5.2583C6.87549 4.80047 6.95482 4.39471 7.14667 4.01807L7.26874 3.79932C7.5728 3.30371 8.00855 2.89973 8.52948 2.63428L8.67206 2.56787C9.00854 2.42345 9.36978 2.35844 9.77069 2.32568C10.2209 2.28891 10.778 2.28955 11.467 2.28955H14.3C14.9891 2.28955 15.546 2.2889 15.9963 2.32568C16.4541 2.3631 16.8599 2.44247 17.2365 2.63428L17.4553 2.75635C17.951 3.06044 18.3548 3.49703 18.6203 4.01807L18.6867 4.16065C18.8309 4.49694 18.8962 4.85765 18.9289 5.2583C18.9657 5.70854 18.965 6.2655 18.965 6.95459V9.7876Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CheckIcon({ size = "xs" }: { size?: "xs" | "2xs" }) {
  return (
    <svg
      aria-hidden="true"
      className={size === "xs" ? "codex-md-check-icon codex-md-icon-xs" : "codex-md-check-icon codex-md-icon-2xs"}
      fill="none"
      height="17"
      viewBox="0 0 17 17"
      width="17"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M12.8961 3.64101C13.1297 3.41418 13.4984 3.37523 13.7779 3.56581C14.0571 3.75635 14.1554 4.11331 14.0299 4.41347L13.9615 4.53847L7.71151 13.7045C7.59411 13.8767 7.4063 13.9877 7.19881 14.0072C6.99136 14.0267 6.78564 13.9533 6.63826 13.806L2.88826 10.056L2.79842 9.9457C2.6192 9.67407 2.64927 9.30496 2.88826 9.06581C3.12738 8.82669 3.49647 8.79676 3.76815 8.97597L3.8785 9.06581L7.03084 12.2182L12.8053 3.74941L12.8961 3.64101Z"
        fill="currentColor"
      />
    </svg>
  );
}

function CopyButton({
  ariaLabel,
  copiedAriaLabel,
  className,
  iconSize,
  onCopy,
}: {
  ariaLabel: string;
  copiedAriaLabel: string;
  className: string;
  iconSize: "xs" | "2xs";
  onCopy: () => Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current != null) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleClick = async (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    await onCopy();
    setCopied(true);
    if (timeoutRef.current != null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      timeoutRef.current = null;
    }, 2000);
  };

  return (
    <button
      aria-label={copied ? copiedAriaLabel : ariaLabel}
      className={[className, copied ? "text-token-foreground" : null].filter(Boolean).join(" ")}
      onClick={(event) => void handleClick(event)}
      type="button"
    >
      {copied ? <CheckIcon size={iconSize} /> : <CopyIcon size={iconSize} />}
    </button>
  );
}

function ActualSizeIcon() {
  return (
    <svg aria-hidden="true" className="codex-md-icon-2xs" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4.33496 11C4.33496 10.6327 4.63273 10.335 5 10.335C5.36727 10.335 5.66504 10.6327 5.66504 11V14.335H9L9.13379 14.3486C9.43692 14.4106 9.66504 14.6786 9.66504 15C9.66504 15.3214 9.43692 15.5894 9.13379 15.6514L9 15.665H5C4.63273 15.665 4.33496 15.3673 4.33496 15V11ZM14.335 9V5.66504H11C10.6327 5.66504 10.335 5.36727 10.335 5C10.335 4.63273 10.6327 4.33496 11 4.33496H15L15.1338 4.34863C15.4369 4.41057 15.665 4.67857 15.665 5V9C15.665 9.36727 15.3673 9.66504 15 9.66504C14.6327 9.66504 14.335 9.36727 14.335 9Z"
        fill="currentColor"
      />
    </svg>
  );
}

function FitWidthIcon() {
  return (
    <svg aria-hidden="true" className="codex-md-icon-2xs" fill="none" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M16.0299 3.0293C16.2896 2.76996 16.7107 2.76988 16.9703 3.0293C17.23 3.28899 17.23 3.711 16.9703 3.9707L13.2731 7.66797H16.9996L17.1344 7.68164C17.4372 7.74375 17.6645 8.01192 17.6647 8.33301C17.6647 8.65421 17.4372 8.92219 17.1344 8.98438L16.9996 8.99805H11.6666C11.2994 8.99801 11.0016 8.70026 11.0016 8.33301V3C11.0016 2.63275 11.2994 2.33499 11.6666 2.33496C12.0339 2.33496 12.3317 2.63273 12.3317 3V6.72754L16.0299 3.0293ZM8.99475 17C8.99475 17.3673 8.69698 17.665 8.32971 17.665C7.96258 17.6649 7.66467 17.3672 7.66467 17V13.2725L3.96741 16.9707C3.70771 17.2304 3.2857 17.2304 3.026 16.9707C2.7663 16.711 2.7663 16.289 3.026 16.0293L6.72424 12.332H2.9967C2.62955 12.332 2.33185 12.0341 2.33167 11.667C2.33167 11.2997 2.62943 11.002 2.9967 11.002H8.32971C8.69698 11.002 8.99475 11.2997 8.99475 11.667V17Z"
        fill="currentColor"
      />
    </svg>
  );
}

function renderMermaidSvg(target: HTMLDivElement, svg: string, source: string, actualSize: boolean) {
  target.innerHTML = "";

  const screenReaderLabel = target.ownerDocument.createElement("span");
  screenReaderLabel.className = "codex-md-sr-only";
  screenReaderLabel.textContent = "Mermaid source code";
  target.append(screenReaderLabel);

  const sourceBlock = target.ownerDocument.createElement("pre");
  sourceBlock.className = "codex-md-sr-only codex-md-mermaid-source";
  sourceBlock.textContent = source;
  target.append(sourceBlock);

  const template = target.ownerDocument.createElement("template");
  template.innerHTML = svg;
  target.append(template.content.cloneNode(true));

  const svgElement = target.querySelector("svg");
  if (svgElement instanceof SVGSVGElement) {
    applyMermaidSvgSize(svgElement, actualSize);
  }
}

function applyMermaidSvgSize(svg: SVGSVGElement, actualSize: boolean) {
  svg.style.height = "auto";
  if (actualSize) {
    svg.style.maxWidth = "none";
    svg.style.maxHeight = "none";
    svg.style.width = svg.viewBox.baseVal.width > 0 ? `${svg.viewBox.baseVal.width}px` : "auto";
    return;
  }
  svg.style.maxWidth = "100%";
  svg.style.maxHeight = "var(--markdown-wide-block-max-height)";
  svg.style.width = "100%";
}

function sanitizeMermaidCode(value: string): string | null {
  let foundUnsafeInit = false;
  const withoutInit = value.replace(/%%\{[\s\S]*?\}%%/g, (match) => {
    if (/securityLevel\s*:/i.test(match)) {
      foundUnsafeInit = true;
    }
    return "";
  });
  if (foundUnsafeInit) return null;
  return withoutInit.replace(/^\s*click\s+.*$/gim, "");
}

function getMermaidDiagramKind(value: string | null): string | null {
  if (value == null) return null;
  const diagramKinds: Record<string, string> = {
    classdiagram: "class",
    entityrelationshipdiagram: "entityRelationship",
    erdiagram: "entityRelationship",
    gitgraph: "gitgraph",
    gitgraphbeta: "gitgraph",
    journey: "journey",
    kanban: "kanban",
    packet: "packet",
    pie: "pie",
    sequencediagram: "sequence",
    statediagram: "state",
    userjourney: "journey",
    xychart: "xychart",
  };
  const firstLine = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("%%"));
  if (firstLine == null) return null;
  const keyword = firstLine.split(/\s+/)[0]?.replace(/[-_]/g, "").toLowerCase();
  return keyword == null ? null : diagramKinds[keyword] ?? null;
}

function getMermaidThemeVariables(target: HTMLElement) {
  const styles = getComputedStyle(target);
  const token = (name: string) => styles.getPropertyValue(name).trim();
  const fallback = (value: string, fallbackValue: string) => value || fallbackValue;
  const textColor = fallback(token("--color-token-foreground"), "rgb(13, 13, 13)");
  const secondaryTextColor = fallback(token("--color-token-description-foreground"), "rgba(13, 13, 13, 0.495)");
  const lineColor = secondaryTextColor;
  const primaryColor = fallback(token("--color-token-input-background"), "rgba(255, 255, 255, 0.96)");
  const secondaryColor = fallback(token("--color-background-elevated-secondary"), "rgba(13, 13, 13, 0.04)");
  const tertiaryColor = fallback(token("--color-token-text-code-block-background"), "rgba(13, 13, 13, 0.078)");
  const background = fallback(token("--color-token-main-surface-primary"), "rgb(255, 255, 255)");
  const edgeLabelBackground = fallback(token("--color-background-editor-opaque"), background);
  const primaryBorderColor = fallback(token("--color-token-input-border"), "rgba(13, 13, 13, 0.078)");

  return {
    actorBkg: primaryColor,
    actorBorder: lineColor,
    actorLineColor: lineColor,
    actorTextColor: textColor,
    activationBkgColor: secondaryColor,
    activationBorderColor: lineColor,
    background,
    clusterBkg: secondaryColor,
    clusterBorder: primaryBorderColor,
    defaultLinkColor: lineColor,
    edgeLabelBackground,
    labelBackgroundColor: edgeLabelBackground,
    labelBoxBkgColor: primaryColor,
    labelBoxBorderColor: primaryBorderColor,
    labelTextColor: textColor,
    lineColor,
    loopTextColor: textColor,
    mainBkg: primaryColor,
    nodeBorder: primaryBorderColor,
    noteBkgColor: secondaryColor,
    noteBorderColor: primaryBorderColor,
    noteTextColor: textColor,
    primaryBorderColor,
    primaryColor,
    primaryTextColor: textColor,
    relationColor: lineColor,
    relationLabelBackground: edgeLabelBackground,
    relationLabelColor: textColor,
    secondaryBorderColor: primaryBorderColor,
    secondaryColor,
    secondaryTextColor,
    sequenceNumberColor: textColor,
    signalColor: lineColor,
    signalTextColor: textColor,
    tertiaryBorderColor: primaryBorderColor,
    tertiaryColor,
    tertiaryTextColor: secondaryTextColor,
    textColor,
    titleColor: textColor,
  };
}

function useStableMermaidId(): string {
  return `codex-md-mermaid-${useId().replace(/:/g, "")}`;
}

async function copyText(value: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard != null) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the legacy copy path used by some embedded runtimes.
    }
  }
  if (typeof document === "undefined" || document.body == null) {
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.append(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    document.execCommand?.("copy");
  } finally {
    textarea.remove();
  }
}
