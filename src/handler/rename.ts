import {
	TextDocumentEdit,
	QuickfixItem,
	Logger,
	Neovim,
	workspace
} from 'coc.nvim'
import Handler from '.'
import { byteIndex } from '../utils/strings'

var log: Logger

export default class Rename {
	constructor(private nvim: Neovim, private handler: Handler) {
		log = this.handler.logger
	}

	public async editStateToQuickfixItems(): Promise<QuickfixItem[] | undefined> {
		let items: QuickfixItem[] = []
		// @ts-expect-error
		let textDocumentEdits = workspace.files.editState?.edit.documentChanges as TextDocumentEdit[]
		if (!textDocumentEdits || textDocumentEdits.length < 2) {
			return
		}
		let first = textDocumentEdits[0].textDocument.uri
		if (textDocumentEdits.every((o) => { o.textDocument.uri == first })) {
			return
		}
		for (const edit of textDocumentEdits) {
			let { textDocument, edits } = edit
			let doc = workspace.getDocument(textDocument.uri)
			let bufnr = doc.bufnr
			let lines = doc.textDocument.lines
			for (const edit of edits) {
				let { range } = edit
				let { start, end } = range
				let text = lines[start.line]
				items.push({
					bufnr,
					lnum: start.line + 1,
					end_lnum: end.line + 1,
					col: byteIndex(text, start.character) + 1,
					end_col: byteIndex(lines[end.line], end.character) + 1,
					text
				})
			}
		}
		return items
	}
}
