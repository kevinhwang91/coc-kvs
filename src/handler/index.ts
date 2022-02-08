import {
	CancellationToken,
	CancellationTokenSource,
	Disposable,
	events,
	Logger,
	Neovim, StatusBarItem, Thenable,
	window
} from 'coc.nvim'
import Fold from './fold'
import Symbols from './symbol'

export default class Handler {
	public readonly fold: Fold
	public readonly symbols: Symbols
	private requestStatusItem: StatusBarItem
	private requestTokenSource: CancellationTokenSource | undefined | null
	private requestTimer?: NodeJS.Timer
	private disposables: Disposable[] = []
	constructor(private nvim: Neovim, public logger: Logger) {
		this.requestStatusItem = window.createStatusBarItem(0, { progress: true })
		events.on(['CursorMoved', 'CursorMovedI', 'InsertEnter', 'InsertSnippet', 'InsertLeave'], () => {
			if (this.requestTokenSource) {
				this.requestTokenSource.cancel()
				this.requestTokenSource = null
			}
		}, null, this.disposables)

		this.fold = new Fold(this.nvim, this)
		this.symbols = new Symbols(this.nvim, this)

		this.disposables.push({
			dispose: () => {

			}
		})
	}

	public async withRequestToken<T>(name: string, fn: (token: CancellationToken) => Thenable<T>, checkEmpty?: boolean): Promise<T | null> {
		if (this.requestTokenSource) {
			this.requestTokenSource.cancel()
			this.requestTokenSource.dispose()
		}
		if (this.requestTimer) {
			clearTimeout(this.requestTimer)
		}
		let statusItem = this.requestStatusItem
		this.requestTokenSource = new CancellationTokenSource()
		let { token } = this.requestTokenSource
		token.onCancellationRequested(() => {
			statusItem.text = `${name} request canceled`
			statusItem.isProgress = false
			this.requestTimer = setTimeout(() => {
				statusItem.hide()
			}, 500)
		})
		statusItem.isProgress = true
		statusItem.text = `requesting ${name}`
		statusItem.show()
		let res = await Promise.resolve(fn(token))
		if (this.requestTokenSource) {
			this.requestTokenSource.dispose()
			this.requestTokenSource = undefined
		}
		if (token.isCancellationRequested) return null
		statusItem.hide()
		if (checkEmpty && (!res || (Array.isArray(res) && res.length == 0))) {
			return null
		}
		return res
	}

	private disposeAll(disposables: Disposable[]): void {
		while (disposables.length) {
			const item = disposables.pop()
			if (item) {
				item.dispose()
			}
		}
	}

	public dispose(): void {
		if (this.requestTimer) {
			clearTimeout(this.requestTimer)
		}
		this.disposeAll(this.disposables)
	}
}
