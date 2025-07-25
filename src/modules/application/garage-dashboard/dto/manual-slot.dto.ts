export class ManualSlotDto {
  date: string; // e.g., "2025-07-20"
  slots: {
    start_time: string; // "HH:mm"
    end_time: string; // "HH:mm"
  }[];
  replace?: boolean;
}
