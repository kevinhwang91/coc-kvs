export function byteIndex(content: string, index: number): number {
	let s = content.slice(0, index)
	return Buffer.byteLength(s)
}
