export function formatDate(date: Date | string) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(date));
}
