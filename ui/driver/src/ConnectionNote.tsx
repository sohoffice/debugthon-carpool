/** Static, no blinking: the driver must know requests may not arrive (REQ-066 still holds). */
export function ConnectionNote() {
  return (
    <p role="status" className="mt-6 border-l-4 border-danger pl-3 text-xl font-semibold">
      連線中斷，正在重新連線
    </p>
  )
}
