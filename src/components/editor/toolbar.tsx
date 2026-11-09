"use client";

import { useRef, useState } from "react";
import { useEditorState, type Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Columns3,
  Gauge,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Minus,
  MessageSquareQuote,
  Palette,
  Plus,
  Quote,
  Redo2,
  SeparatorHorizontal,
  Strikethrough,
  Table2,
  Trash2,
  Underline,
  Undo2,
  Unlink,
  StickyNote,
  Rows3,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errorMessage } from "@/lib/api-client";
import { BRAND_TEXT_COLORS, isSafeHref } from "@/lib/content/schema";
import type { AssetMeta } from "@/lib/types";
import { cn } from "@/lib/utils";

const BLOCK_TYPES = [
  { key: "paragraph", label: "Body text" },
  { key: "h1", label: "Title" },
  { key: "h2", label: "Heading" },
  { key: "h3", label: "Subheading" },
] as const;

export function EditorToolbar({ editor, brandColor, extraInsert }: { editor: Editor; brandColor: string; extraInsert?: React.ReactNode }) {
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive("heading", { level: 1 })
        ? "h1"
        : e.isActive("heading", { level: 2 })
          ? "h2"
          : e.isActive("heading", { level: 3 })
            ? "h3"
            : "paragraph",
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      strike: e.isActive("strike"),
      link: e.isActive("link"),
      href: (e.getAttributes("link").href as string | undefined) ?? "",
      color: (e.getAttributes("textStyle").color as string | undefined) ?? null,
      align: (["center", "right", "justify"] as const).find((a) => e.isActive({ textAlign: a })) ?? "left",
      bullet: e.isActive("bulletList"),
      ordered: e.isActive("orderedList"),
      quote: e.isActive("blockquote"),
      table: e.isActive("table"),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (!state) return null;
  const chain = () => editor.chain().focus();

  function setBlock(key: string) {
    if (key === "paragraph") chain().setParagraph().run();
    else chain().toggleHeading({ level: Number(key.slice(1)) as 1 | 2 | 3 }).run();
  }

  async function uploadImage(file: File) {
    setUploading(true);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("kind", "image");
      const asset = await api<AssetMeta>("/api/assets", { form });
      chain().insertAssetImage({ assetId: asset.id, alt: "" }).run();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight, justify: AlignJustify } as const;
  const AlignIcon = ALIGN_ICONS[state.align as keyof typeof ALIGN_ICONS] ?? AlignLeft;

  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-lg border bg-background p-1 shadow-xs" role="toolbar" aria-label="Formatting">
      <Tool label="Undo (⌘Z)" onClick={() => chain().undo().run()} disabled={!state.canUndo}>
        <Undo2 />
      </Tool>
      <Tool label="Redo (⌘⇧Z)" onClick={() => chain().redo().run()} disabled={!state.canRedo}>
        <Redo2 />
      </Tool>
      <Sep />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="w-32 justify-between font-normal">
            {BLOCK_TYPES.find((b) => b.key === state.block)?.label}
            <ChevronDown className="opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {BLOCK_TYPES.map((b) => (
            <DropdownMenuItem key={b.key} onSelect={() => setBlock(b.key)} className={cn(b.key === state.block && "font-medium")}>
              <span className={cn(b.key === "h1" && "text-lg font-bold", b.key === "h2" && "font-bold", b.key === "h3" && "font-semibold")}>{b.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Sep />
      <Tool label="Bold (⌘B)" active={state.bold} onClick={() => chain().toggleBold().run()}>
        <Bold />
      </Tool>
      <Tool label="Italic (⌘I)" active={state.italic} onClick={() => chain().toggleItalic().run()}>
        <Italic />
      </Tool>
      <Tool label="Underline (⌘U)" active={state.underline} onClick={() => chain().toggleUnderline().run()}>
        <Underline />
      </Tool>
      <Tool label="Strikethrough" active={state.strike} onClick={() => chain().toggleStrike().run()}>
        <Strikethrough />
      </Tool>
      <ColorPicker editor={editor} current={state.color} brandColor={brandColor} />
      <LinkEditor editor={editor} active={state.link} href={state.href} />
      <Sep />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Text alignment">
            <AlignIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(
            [
              ["left", AlignLeft, "Left"],
              ["center", AlignCenter, "Center"],
              ["right", AlignRight, "Right"],
              ["justify", AlignJustify, "Justify"],
            ] as const
          ).map(([a, Icon, label]) => (
            <DropdownMenuItem key={a} onSelect={() => chain().setTextAlign(a).run()}>
              <Icon /> {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Tool label="Bulleted list" active={state.bullet} onClick={() => chain().toggleBulletList().run()}>
        <List />
      </Tool>
      <Tool label="Numbered list" active={state.ordered} onClick={() => chain().toggleOrderedList().run()}>
        <ListOrdered />
      </Tool>
      <Tool label="Quote" active={state.quote} onClick={() => chain().toggleBlockquote().run()}>
        <Quote />
      </Tool>
      <Sep />
      <input
        ref={fileInput}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void uploadImage(f);
          e.target.value = "";
        }}
      />
      <Tool label="Insert image" onClick={() => fileInput.current?.click()} disabled={uploading}>
        {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus />}
      </Tool>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            <Plus /> Insert
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-xs text-muted-foreground">Sections</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => chain().insertMetrics().run()}>
            <Gauge /> Key metrics row
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => chain().insertPullQuote().run()}>
            <MessageSquareQuote /> Pull quote
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => chain().insertCallout("note").run()}>
            <StickyNote /> Callout box
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
            <Table2 /> Table
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => chain().insertDivider("short").run()}>
            <Minus /> Short divider
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => chain().insertDivider("full").run()}>
            <SeparatorHorizontal /> Full-width divider
          </DropdownMenuItem>
          {extraInsert}
        </DropdownMenuContent>
      </DropdownMenu>
      {state.table && (
        <>
          <Sep />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm">
                <Table2 /> Table
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => chain().addRowAfter().run()}>
                <Rows3 /> Add row below
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => chain().addColumnAfter().run()}>
                <Columns3 /> Add column right
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => chain().toggleHeaderRow().run()}>Toggle header row</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => chain().deleteRow().run()}>Delete row</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => chain().deleteColumn().run()}>Delete column</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => chain().deleteTable().run()}>
                <Trash2 /> Delete table
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </div>
  );
}

function Sep() {
  return <Separator orientation="vertical" className="mx-1 h-5!" />;
}

function Tool({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-pressed={active}
          disabled={disabled}
          onClick={onClick}
          className={cn(active && "bg-muted text-foreground")}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ColorPicker({ editor, current, brandColor }: { editor: Editor; current: string | null; brandColor: string }) {
  const colors = [...new Set([brandColor.toLowerCase(), ...BRAND_TEXT_COLORS])];
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Text colour">
              <Palette style={{ color: current ?? undefined }} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Text colour</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-auto p-2" align="start">
        <div className="flex items-center gap-1.5">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              className={cn("size-6 rounded-full border-2 border-transparent", current === c && "border-foreground")}
              style={{ backgroundColor: c }}
              onClick={() => editor.chain().focus().setColor(c).run()}
            />
          ))}
          <Button variant="ghost" size="xs" onClick={() => editor.chain().focus().unsetColor().run()}>
            Reset
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LinkEditor({ editor, active, href }: { editor: Editor; active: boolean; href: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function apply(e: React.FormEvent) {
    e.preventDefault();
    let url = value.trim();
    if (url && !/^(https?:|mailto:)/i.test(url)) url = url.includes("@") && !url.includes("/") ? `mailto:${url}` : `https://${url}`;
    if (!isSafeHref(url)) {
      setError("Enter a web address (https://…) or email address.");
      return;
    }
    const { empty } = editor.state.selection;
    if (empty && !active) editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setValue(href);
          setError(null);
        }
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Link (⌘K)" className={cn(active && "bg-muted")}>
              <Link2 />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Link</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-80" align="start">
        <form onSubmit={apply} className="space-y-2">
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://example.com" autoFocus aria-label="Link address" />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex justify-between">
            {active ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  editor.chain().focus().extendMarkRange("link").unsetLink().run();
                  setOpen(false);
                }}
              >
                <Unlink /> Remove link
              </Button>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" disabled={!value.trim()}>
              Apply
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
