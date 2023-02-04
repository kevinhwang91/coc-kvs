import {
	languages,
	Logger,
	Neovim,
	Range,
	SymbolInformation,
	Uri,
	workspace
} from 'coc.nvim'
import { DocumentSymbol, SymbolKind, SymbolTag } from 'vscode-languageserver-types'
import Handler from '.'
import { comparePosition } from '../utils/position'
import { byteIndex } from '../utils/strings'

export interface DocumentSymbolInfo {
	filepath?: string
	name: string
	kind: string
	level?: number
	range: Range
}

export interface WorkSpaceSymbolInfo {
	filepath?: string
	name: string
	kind: SymbolKind
	range: Range
}

export function getSymbolKind(kind: SymbolKind): string {
	switch (kind) {
		case SymbolKind.File:
			return 'File'
		case SymbolKind.Module:
			return 'Module'
		case SymbolKind.Namespace:
			return 'Namespace'
		case SymbolKind.Package:
			return 'Package'
		case SymbolKind.Class:
			return 'Class'
		case SymbolKind.Method:
			return 'Method'
		case SymbolKind.Property:
			return 'Property'
		case SymbolKind.Field:
			return 'Field'
		case SymbolKind.Constructor:
			return 'Constructor'
		case SymbolKind.Enum:
			return 'Enum'
		case SymbolKind.Interface:
			return 'Interface'
		case SymbolKind.Function:
			return 'Function'
		case SymbolKind.Variable:
			return 'Variable'
		case SymbolKind.Constant:
			return 'Constant'
		case SymbolKind.String:
			return 'String'
		case SymbolKind.Number:
			return 'Number'
		case SymbolKind.Boolean:
			return 'Boolean'
		case SymbolKind.Array:
			return 'Array'
		case SymbolKind.Object:
			return 'Object'
		case SymbolKind.Key:
			return 'Key'
		case SymbolKind.Null:
			return 'Null'
		case SymbolKind.EnumMember:
			return 'EnumMember'
		case SymbolKind.Struct:
			return 'Struct'
		case SymbolKind.Event:
			return 'Event'
		case SymbolKind.Operator:
			return 'Operator'
		case SymbolKind.TypeParameter:
			return 'TypeParameter'
		default:
			return 'Unknown'
	}
}

var log: Logger

export default class Symbols {
	constructor(private nvim: Neovim, private handler: Handler) {
		log = this.handler.logger
	}

	private convertSymbols(symbols: DocumentSymbol[]): DocumentSymbolInfo[] {
		let res: DocumentSymbolInfo[] = []
		symbols.forEach((s) => this.addDocumentSymbol(res, s, 0))
		res.sort((a: DocumentSymbolInfo, b: DocumentSymbolInfo) => {
			let aRange = a.range
			let bRange = b.range
			return comparePosition(aRange.start, bRange.start)
		})
		return res
	}

	private addDocumentSymbol(res: DocumentSymbolInfo[], sym: DocumentSymbol, level: number): void {
		let { name, kind, children, range } = sym
		res.push({
			name,
			level,
			kind: getSymbolKind(kind),
			range
		})
		if (children && children.length) {
			for (let sym of children) {
				this.addDocumentSymbol(res, sym, level + 1)
			}
		}
	}

	private isDocumentSymbols(a: DocumentSymbol[] | SymbolInformation[]): a is DocumentSymbol[] {
		let a0 = a[0]
		return a0 && !a0.hasOwnProperty('location')
	}

	public async getDocumentSymbols(
		bufnr?: number,
		kinds?: string[]
	): Promise<DocumentSymbolInfo[] | undefined> {
		let { nvim } = workspace
		bufnr = typeof bufnr == 'number' ? bufnr : (await nvim.buffer).id
		let doc = workspace.getDocument(bufnr)
		if (!doc || !doc.attached) {
			return
		}

		let docSymbols = await this.handler.withRequestToken('documentsymbols', token => {
			// @ts-expect-error
			return languages.getDocumentSymbol(doc, token)
		}, true) as null | DocumentSymbol[] | SymbolInformation[]

		if (!docSymbols) {
			return
		}
		let res: DocumentSymbol[]
		if (this.isDocumentSymbols(docSymbols)) {
			res = docSymbols
		} else {
			res = docSymbols.map((o) => {
				let sym = DocumentSymbol.create(
					o.name,
					'',
					o.kind,
					o.location.range,
					o.location.range
				)
				if (o.deprecated) sym.tags = [SymbolTag.Deprecated]
				return sym
			})
		}

		let symbols: DocumentSymbolInfo[] | undefined
		if (res) {
			symbols = this.convertSymbols(res)
			if (kinds) {
				kinds = kinds.map((k) => k.charAt(0).toUpperCase() + k.slice(1))
				symbols = symbols.filter((s) => kinds!.includes(s.kind))
			}
			let lines = doc.getLines()
			for (const sym of symbols) {
				let { start, end } = sym.range
				start.character = byteIndex(lines[start.line], start.character)
				end.character = byteIndex(lines[end.line], end.character)
			}
		}
		return symbols
	}

	public async getWorkspaceSymbols(input: string): Promise<SymbolInformation[]> {
		let workspaceSymbols = await this.handler.withRequestToken('workspaceSymbols', token => {
			// @ts-expect-error
			return languages.getWorkspaceSymbols(input, token)
		}, true) as SymbolInformation[]
		return workspaceSymbols
	}

	public async fzfWorkspaceSymbolsSource(input: string, path: string): Promise<void> {
		let workspaceSymbols = await this.handler.withRequestToken('workspaceSymbols', token => {
			// @ts-expect-error
			return languages.getWorkspaceSymbols(input, token)
		}, true) as SymbolInformation[]
		let symbols: WorkSpaceSymbolInfo[] | undefined
		symbols = workspaceSymbols.map((s) => {
			let { name, kind, location } = s
			let { range, uri } = location
			let file = Uri.parse(uri).fsPath
			return {
				name,
				filepath: file,
				kind,
				range
			}
		})
		log.error(symbols)
	}
}
