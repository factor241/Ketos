/**
 * Localized chrome for the window lane's tool blocks. Each builder binds the
 * board dictionary at the render site, so the ui-primitives blocks — which own
 * no copy — draw their status pills, summaries, and copy or expand controls in
 * the active locale.
 */
import type {
  DiffBlockLabels, MarkdownLabels, ReadBlockLabels, SearchBlockLabels, TerminalBlockLabels, WebBlockLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { BoardTranslate } from '../locale.ts'

/**
 * Terminal block chrome.
 * @param t - board locale seat.
 * @returns the terminal labels for the active locale.
 */
export function terminalBlockLabels(t: BoardTranslate): TerminalBlockLabels {
  return {
    signal: signal => t('terminal.signal', { signal }),
    exitCode: code => t('terminal.exitCode', { code }),
    running: t('terminal.running'),
    failed: t('terminal.failed'),
    done: t('terminal.done'),
    copy: t('markdown.copy'),
    copied: t('markdown.copied'),
    noOutput: t('terminal.noOutput'),
    collapseAria: t('block.collapseAria'),
    collapse: t('block.collapse'),
    expandAria: hidden => t('block.expandAria', { count: hidden }),
    expand: hidden => t('block.expand', { count: hidden }),
  }
}

/**
 * Read block chrome.
 * @param t - board locale seat.
 * @returns the read labels for the active locale.
 */
export function readBlockLabels(t: BoardTranslate): ReadBlockLabels {
  return {
    window: (shown, total) => t('read.window', { shown, total }),
    copy: t('markdown.copy'),
    copied: t('markdown.copied'),
    collapseAria: t('block.collapseAria'),
    collapse: t('block.collapse'),
    expandAria: hidden => t('block.expandAria', { count: hidden }),
    expand: hidden => t('block.expand', { count: hidden }),
  }
}

/**
 * Diff block chrome.
 * @param t - board locale seat.
 * @returns the diff labels for the active locale.
 */
export function diffBlockLabels(t: BoardTranslate): DiffBlockLabels {
  return {
    copy: t('markdown.copy'),
    copied: t('markdown.copied'),
    collapseAria: t('block.collapseAria'),
    collapse: t('block.collapse'),
    expandAria: hidden => t('block.expandAria', { count: hidden }),
    expand: hidden => t('block.expand', { count: hidden }),
    files: count => count === 1 ? t('diff.files.one', { count }) : t('diff.files.other', { count }),
  }
}

/**
 * Search block chrome.
 * @param t - board locale seat.
 * @returns the search labels for the active locale.
 */
export function searchBlockLabels(t: BoardTranslate): SearchBlockLabels {
  return {
    pathsSummary: (shown, total, truncated) => truncated
      ? t('search.paths.truncated', { total })
      : t('search.paths', { shown, total }),
    matchesSummary: (shown, total, files, truncated) => truncated
      ? t('search.matches.truncated', { total, files })
      : t('search.matches', { shown, total, files }),
    copy: t('markdown.copy'),
    copied: t('markdown.copied'),
    noResults: t('search.noResults'),
    collapseAria: t('block.collapseAria'),
    collapse: t('block.collapse'),
    expandAria: hidden => t('block.expandAria', { count: hidden }),
    expand: hidden => t('block.expand', { count: hidden }),
  }
}

/**
 * Web block chrome.
 * @param t - board locale seat.
 * @returns the web labels for the active locale, including the markdown seat its answer renders through.
 */
export function webBlockLabels(t: BoardTranslate): WebBlockLabels {
  const markdown: MarkdownLabels = {
    code: { copyLabel: t('markdown.copy'), copiedLabel: t('markdown.copied') },
    footnotes: t('markdown.footnotes'),
  }
  return {
    noResults: t('web.noResults'),
    sourcesTruncated: t('web.sourcesTruncated'),
    http: t('web.http'),
    contentTruncated: t('web.contentTruncated'),
    markdown,
  }
}
