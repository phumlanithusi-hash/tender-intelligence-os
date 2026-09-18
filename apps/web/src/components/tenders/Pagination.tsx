import { Button } from '../ui/button.js'

export function Pagination({
  page,
  totalPages,
  onPageChange,
}: {
  page: number
  totalPages: number | null
  onPageChange: (page: number) => void
}) {
  return (
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-sm text-muted-foreground">
      <span>
        Page {page}
        {totalPages ? ` of ${totalPages}` : ''}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={totalPages !== null && page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
