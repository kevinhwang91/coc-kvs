import {
	FoldingRange,
	languages,
	Logger,
	Neovim,
	workspace
} from 'coc.nvim'
import Handler from '.'

var log: Logger

export default class Fold {
	constructor(private nvim: Neovim, private handler: Handler) {
		log = this.handler.logger
	}

	public async foldingRange(bufnr: number, kind?: string | 'comment' | 'region'): Promise<any[] | undefined> {
		let doc = workspace.getDocument(bufnr)
		if (!doc || !doc.attached) {
			return
		}
		// @ts-expect-error
		if (!languages.hasProvider('foldingRange', doc.textDocument)) {
			return
		}
		// @ts-expect-error
		await doc.synchronize()

		let ranges = await this.handler.withRequestToken('foldingrange', token => {
			// @ts-expect-error
			return languages.provideFoldingRanges(doc.textDocument, {}, token)
		}, true) as FoldingRange[] | null
		if (!ranges) {
			return []
		}

		return ranges.filter(o => (!kind || kind == o.kind) && o.startLine < o.endLine)
			.sort((a, b) => b.startLine - a.startLine)
	}
}
