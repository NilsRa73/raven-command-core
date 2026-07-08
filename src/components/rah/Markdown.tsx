import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import { toast } from "sonner";
import { useState, type ReactNode } from "react";

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  return (
    <div className="relative group my-3">
      {lang && <div className="absolute right-2 top-1 text-[10px] uppercase tracking-widest text-muted-foreground">{lang}</div>}
      <button
        type="button"
        onClick={async () => {
          try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); toast.success("Copied"); }
          catch { toast.error("Copy failed"); }
        }}
        className="absolute right-2 bottom-2 rounded-md border border-border/60 bg-background/70 px-2 py-1 text-[10px] opacity-0 group-hover:opacity-100 transition"
      >
        {copied ? "Copied" : "Copy"}
      </button>
      <pre className="overflow-x-auto rounded-md border border-border/60 bg-background/60 p-3 text-xs leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="text-sm leading-relaxed [&_h1]:text-xl [&_h2]:text-lg [&_h3]:text-base [&_h1]:mt-4 [&_h2]:mt-4 [&_h3]:mt-3 [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_p]:my-2 [&_ul]:my-2 [&_ul]:pl-5 [&_ul]:list-disc [&_ol]:my-2 [&_ol]:pl-5 [&_ol]:list-decimal [&_li]:my-0.5 [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-background/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_table]:my-3 [&_table]:w-full [&_th]:border [&_th]:border-border/60 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border/60 [&_td]:px-2 [&_td]:py-1 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/60 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children, ...props }: any) => {
            const isBlock = /language-/.test(className ?? "") || String(children ?? "").includes("\n");
            if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
            return <code className={className} {...props}>{children}</code>;
          },
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener">{children}</a>,
        }}
      >{children}</ReactMarkdown>
    </div>
  );
}