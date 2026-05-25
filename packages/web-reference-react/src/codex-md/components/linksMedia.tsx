import type { ReactNode } from "react";
import type {
  CodexMarkdownComponents,
  FileCitationComponentProps,
  LinkComponentProps,
} from "../types";
import {
  HTML_LITERAL_CLASS_NAME,
  IMAGE_ELEMENT_STYLE,
  IMAGE_ENTER_EVIDENCE_CLASS_NAME,
  TABLE_CELL_FILE_LINK_CLASS_NAME,
} from "../classNames";

export const linksMediaComponents: Pick<
  CodexMarkdownComponents,
  "externalLink" | "fileCitation" | "image" | "htmlLiteral"
> = {
  externalLink(props) {
    return <ExternalLink {...props} />;
  },

  fileCitation(props) {
    return <FileCitation {...props} />;
  },

  image({ node }) {
    return (
      <button
        aria-label={node.alt || "image"}
        className={`codex-md-image-button ${IMAGE_ENTER_EVIDENCE_CLASS_NAME} my-3 block h-auto rounded-md object-contain shadow-md max-h-[min(48vh,32rem)] max-w-[min(100%,44rem)] bg-token-toolbar-hover-background text-token-description-foreground inline-flex min-h-24 min-w-24 max-w-full cursor-default items-center justify-center border-0 p-0`}
        disabled
        title={node.title}
        type="button"
      >
        <img
          alt=""
          decoding="async"
          draggable={false}
          referrerPolicy="no-referrer"
          src={node.src}
          style={IMAGE_ELEMENT_STYLE}
        />
      </button>
    );
  },

  htmlLiteral({ node }) {
    if (node.block) {
      return <>{node.value}</>;
    }
    return <span className={HTML_LITERAL_CLASS_NAME}>{node.value}</span>;
  },
};

function ExternalLink({ node, children, onExternalLinkClick }: LinkComponentProps) {
  return (
    <a
      className="group/inline-mention cursor-pointer"
      href={node.href}
      onClick={(event) => onExternalLinkClick?.(node.href, event)}
      rel="noopener noreferrer"
      target="_blank"
      title={node.title}
    >
      <InlineMentionBrand icon={<ExternalLinkIcon />} textClassName="codex-md-link-label">
        {children}
      </InlineMentionBrand>
    </a>
  );
}

function FileCitation({ node, onOpenFile }: FileCitationComponentProps) {
  const label = formatFileLabel(node.reference);
  const icon =
    node.reference.line == null
      ? <FileReferenceIcon />
      : node.reference.endLine != null && node.reference.endLine !== node.reference.line
        ? <LineRangeReferenceIcon />
        : <CodeReferenceIcon />;
  const content = (
    <span className="codex-md-inline-tooltip break-words whitespace-normal" data-state="closed">
      <InlineMentionBrand className={TABLE_CELL_FILE_LINK_CLASS_NAME} icon={icon}>
        {label}
      </InlineMentionBrand>
    </span>
  );

  if (onOpenFile == null) {
    return (
      <a
        className="codex-md-file-citation group/inline-mention cursor-pointer inline bg-transparent p-0 text-left align-baseline whitespace-normal"
        href={formatFileHref(node.reference)}
        style={{ fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit" }}
        title={node.reference.path}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className="codex-md-file-citation group/inline-mention cursor-pointer inline appearance-none border-0 bg-transparent p-0 text-left align-baseline whitespace-normal"
      onClick={() => onOpenFile?.(node.reference)}
      style={{ fontFamily: "inherit", fontSize: "inherit", lineHeight: "inherit" }}
      title={node.reference.path}
      type="button"
    >
      {content}
    </button>
  );
}

function InlineMentionBrand({
  children,
  className,
  icon,
  textClassName,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
  textClassName?: string;
}) {
  return (
    <span
      className={[
        "codex-md-inline-mention-brand px-0.5 inline-mention-brand-aware font-medium text-[color:var(--inline-mention-color)] [--inline-mention-color:var(--inline-mention-resolved-base-color,var(--inline-mention-base-color))] [--inline-mention-base-color:color-mix(in_srgb,var(--color-token-text-link-foreground)_80%,var(--color-token-foreground)_20%)] group-hover/inline-mention:underline group-hover/inline-mention:decoration-current group-hover/inline-mention:decoration-dashed group-hover/inline-mention:decoration-[0.5px] group-hover/inline-mention:underline-offset-2 whitespace-nowrap",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      data-state="closed"
    >
      {icon == null ? null : <span className="codex-md-inline-mention-icon relative mr-[3px] inline-block h-[1lh] w-4 align-bottom">{icon}</span>}
      <span className={["codex-md-inline-mention-text min-w-0 break-words whitespace-normal", textClassName].filter(Boolean).join(" ")}>
        {children}
      </span>
    </span>
  );
}

function FileReferenceIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon-xs absolute top-1/2 -translate-y-1/2"
      fill="currentColor"
      height="10"
      viewBox="0 0 10 10"
      width="10"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M1.4585 6.54161V3.45812C1.4585 3.115 1.45807 2.83254 1.47681 2.60322C1.49594 2.36903 1.53694 2.15357 1.63997 1.95136L1.70427 1.83662C1.86439 1.57557 2.09396 1.36282 2.36833 1.22301L2.44482 1.1872C2.62471 1.11004 2.81525 1.07659 3.02018 1.05984C3.24951 1.04111 3.53196 1.04153 3.87508 1.04153H5.63005C5.91595 1.04153 6.12695 1.03878 6.32992 1.08751L6.45606 1.12332C6.58043 1.16376 6.69992 1.21881 6.81169 1.2873L6.8772 1.33002C7.02732 1.43474 7.16218 1.57269 7.33903 1.74954L7.83382 2.24433L7.97624 2.38715C8.10903 2.52211 8.21429 2.63828 8.29606 2.77168L8.36035 2.88601C8.41974 3.00259 8.46523 3.12594 8.49585 3.25345L8.51172 3.33035C8.54382 3.51054 8.54183 3.70323 8.54183 3.95332V6.54161C8.54183 6.88473 8.54226 7.16719 8.52352 7.39651C8.50677 7.60145 8.47332 7.79198 8.39616 7.97187L8.36035 8.04837C8.22054 8.32273 8.00779 8.55231 7.74674 8.71243L7.632 8.77672C7.42979 8.87975 7.21433 8.92075 6.98014 8.93989C6.75082 8.95863 6.46837 8.9582 6.12524 8.9582H3.87508C3.53196 8.9582 3.24951 8.95863 3.02018 8.93989C2.81525 8.92314 2.62471 8.88969 2.44482 8.81253L2.36833 8.77672C2.09396 8.63691 1.86439 8.42416 1.70427 8.16311L1.63997 8.04837C1.53694 7.84616 1.49594 7.6307 1.47681 7.39651C1.45807 7.16719 1.4585 6.88473 1.4585 6.54161ZM5.41683 5.41653C5.64695 5.41653 5.8335 5.60308 5.8335 5.8332C5.8335 6.06332 5.64695 6.24987 5.41683 6.24987H3.75016C3.52004 6.24987 3.3335 6.06332 3.3335 5.8332C3.3335 5.60308 3.52004 5.41653 3.75016 5.41653H5.41683ZM6.25016 3.74987C6.48028 3.74987 6.66683 3.93641 6.66683 4.16653C6.66683 4.39665 6.48028 4.5832 6.25016 4.5832H3.75016C3.52004 4.5832 3.3335 4.39665 3.3335 4.16653C3.3335 3.93641 3.52004 3.74987 3.75016 3.74987H6.25016ZM2.29183 6.54161C2.29183 6.89844 2.29198 7.14104 2.30729 7.32856C2.32222 7.51123 2.34937 7.60478 2.38257 7.66995L2.41471 7.72732C2.49477 7.85785 2.60956 7.96422 2.74675 8.03413L2.80208 8.05773C2.8644 8.08002 2.95122 8.09822 3.08814 8.1094C3.27565 8.12472 3.51825 8.12487 3.87508 8.12487H6.12524C6.48207 8.12487 6.72468 8.12472 6.91219 8.1094C7.09486 8.09448 7.18841 8.06733 7.25358 8.03413L7.31095 8.00198C7.44148 7.92192 7.54785 7.80713 7.61776 7.66995L7.64136 7.61461C7.66365 7.55229 7.68185 7.46548 7.69303 7.32856C7.70835 7.14104 7.7085 6.89844 7.7085 6.54161V3.95332C7.7085 3.70924 7.70684 3.59482 7.69751 3.51712L7.6853 3.44794C7.67 3.38427 7.64741 3.32265 7.61776 3.26443L7.58561 3.20706C7.55147 3.15138 7.50616 3.09869 7.38867 2.97879L7.24463 2.83352L6.74984 2.33873C6.57722 2.16612 6.49521 2.08597 6.43368 2.03763L6.3763 1.99775C6.32043 1.96351 6.26066 1.93577 6.19849 1.91556L6.13542 1.89806C6.05066 1.87771 5.95562 1.87487 5.63005 1.87487H3.87508C3.51825 1.87487 3.27565 1.87501 3.08814 1.89033C2.95122 1.90151 2.8644 1.91971 2.80208 1.942L2.74675 1.9656C2.60956 2.03551 2.49477 2.14189 2.41471 2.27241L2.38257 2.32978C2.34937 2.39495 2.32222 2.4885 2.30729 2.67117C2.29198 2.85869 2.29183 3.10129 2.29183 3.45812V6.54161Z" />
    </svg>
  );
}

function CodeReferenceIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon-xs absolute top-1/2 -translate-y-1/2"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M8.88209 4.11875C9.01273 3.90863 9.27695 3.81162 9.51802 3.90078C9.79355 4.00283 9.93413 4.30963 9.83209 4.58516L7.16568 11.7852L7.11802 11.8813C6.98738 12.0914 6.72316 12.1884 6.48209 12.0992C6.20656 11.9972 6.06598 11.6904 6.16802 11.4148L8.83443 4.21485L8.88209 4.11875ZM3.53521 4.14141C3.67798 3.88477 4.0019 3.79252 4.25865 3.93516C4.51529 4.07792 4.60754 4.40184 4.4649 4.6586L2.60787 8L4.4649 11.3414L4.50787 11.4406C4.58217 11.6765 4.48318 11.9399 4.25865 12.0648C4.03385 12.1897 3.75722 12.1348 3.59615 11.9469L3.53521 11.8586L1.53521 8.2586C1.44595 8.09792 1.44595 7.90209 1.53521 7.74141L3.53521 4.14141ZM11.7415 3.93516C11.9663 3.81027 12.2429 3.86517 12.404 4.05313L12.4649 4.14141L14.4649 7.74141C14.5542 7.90209 14.5542 8.09792 14.4649 8.2586L12.4649 11.8586C12.3221 12.1152 11.9982 12.2075 11.7415 12.0648C11.4848 11.9221 11.3926 11.5982 11.5352 11.3414L13.3915 8L11.5352 4.6586L11.4922 4.55938C11.4179 4.32348 11.5169 4.06006 11.7415 3.93516Z" fill="currentColor" />
    </svg>
  );
}

function LineRangeReferenceIcon() {
  return (
    <svg
      aria-hidden="true"
      className="icon-xs absolute top-1/2 -translate-y-1/2"
      fill="none"
      height="16"
      viewBox="0 0 16 16"
      width="16"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M5.99984 2.3335L4.6665 13.6668" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33333" />
      <path d="M11.3333 2.3335L10 13.6668" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33333" />
      <path d="M2.6665 5.3335H13.3332" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33333" />
      <path d="M2.6665 10.6665H13.3332" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.33333" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <span className="codex-md-external-link-icon relative inline-block shrink-0 icon-xs absolute top-1/2 -translate-y-1/2" aria-hidden="true">
      <svg className="codex-md-external-link-svg h-full w-full" fill="currentColor" height="20" viewBox="0 0 20 20" width="20" xmlns="http://www.w3.org/2000/svg">
        <path d="M10 2.125C14.3492 2.125 17.875 5.65076 17.875 10C17.875 14.3492 14.3492 17.875 10 17.875C5.65076 17.875 2.125 14.3492 2.125 10C2.125 5.65076 5.65076 2.125 10 2.125ZM7.88672 10.625C7.94334 12.3161 8.22547 13.8134 8.63965 14.9053C8.87263 15.5194 9.1351 15.9733 9.39453 16.2627C9.65437 16.5524 9.86039 16.625 10 16.625C10.1396 16.625 10.3456 16.5524 10.6055 16.2627C10.8649 15.9733 11.1274 15.5194 11.3604 14.9053C11.7745 13.8134 12.0567 12.3161 12.1133 10.625H7.88672ZM3.40527 10.625C3.65313 13.2734 5.45957 15.4667 7.89844 16.2822C7.7409 15.997 7.5977 15.6834 7.4707 15.3486C6.99415 14.0923 6.69362 12.439 6.63672 10.625H3.40527ZM13.3633 10.625C13.3064 12.439 13.0059 14.0923 12.5293 15.3486C12.4022 15.6836 12.2582 15.9969 12.1006 16.2822C14.5399 15.467 16.3468 13.2737 16.5947 10.625H13.3633ZM12.1006 3.7168C12.2584 4.00235 12.4021 4.31613 12.5293 4.65137C13.0059 5.90775 13.3064 7.56102 13.3633 9.375H16.5947C16.3468 6.72615 14.54 4.53199 12.1006 3.7168ZM10 3.375C9.86039 3.375 9.65437 3.44756 9.39453 3.7373C9.1351 4.02672 8.87263 4.48057 8.63965 5.09473C8.22547 6.18664 7.94334 7.68388 7.88672 9.375H12.1133C12.0567 7.68388 11.7745 6.18664 11.3604 5.09473C11.1274 4.48057 10.8649 4.02672 10.6055 3.7373C10.3456 3.44756 10.1396 3.375 10 3.375ZM7.89844 3.7168C5.45942 4.53222 3.65314 6.72647 3.40527 9.375H6.63672C6.69362 7.56102 6.99415 5.90775 7.4707 4.65137C7.59781 4.31629 7.74073 4.00224 7.89844 3.7168Z" />
      </svg>
    </span>
  );
}

function formatFileLabel(reference: FileCitationComponentProps["node"]["reference"]): string {
  const base = reference.label || reference.path.split(/[\\/]/).pop() || reference.path;
  if (reference.line == null) {
    return base;
  }
  if (reference.endLine != null && reference.endLine !== reference.line) {
    return `${base} (lines ${reference.line}-${reference.endLine})`;
  }
  return `${base} (line ${reference.line})`;
}

function formatFileHref(reference: FileCitationComponentProps["node"]["reference"]): string {
  if (reference.line == null) {
    return reference.path;
  }
  if (reference.endLine != null && reference.endLine !== reference.line) {
    return `${reference.path}:${reference.line}-${reference.endLine}`;
  }
  return `${reference.path}:${reference.line}`;
}
