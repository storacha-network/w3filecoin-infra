export type FerryState = 'LOADING' | 'READY' | 'DEAL_PENDING' | 'DEAL_PROCESSED'

export interface CarItem {
  link: string
  size: number
  commitmentProof: string
  src: string[]
}

export interface CarItemFerry {
  link: string
  size: number
}

export interface FerryTable {
  addCargo: (id: string, items: CarItemFerry[]) => Promise<void>
  getFerryLoading: () => Promise<string>
  setAsReady: (id: string) => Promise<void>
  setAsDealPending: (id: string) => Promise<void>
  setAsDealProcessed: (id: string, commP: string) => Promise<void>
}

export interface FerryOpts {
  endpoint?: string
  maxSize?: number
  minSize?: number
  cargoTableName?: string
}

export interface CarTable {
  batchWrite: (items: CarItem[]) => Promise<void>
}
