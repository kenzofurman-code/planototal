import { supabase } from './supabase';

export type ClimateCity = {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  recordCount: number;
};

export type ClimateImportRow = {
  observationDate: string;
  data: Record<string, unknown>;
};

export async function loadClimateCities(): Promise<ClimateCity[]> {
  if (!supabase) return [];
  const citiesResult = await supabase
    .from('climate_cities')
    .select('id,name,start_date,end_date,record_count')
    .order('name');
  if (citiesResult.error) throw citiesResult.error;
  return (citiesResult.data ?? []).map((city) => ({
    id: city.id,
    name: city.name,
    startDate: city.start_date ?? null,
    endDate: city.end_date ?? null,
    recordCount: Number(city.record_count ?? 0)
  }));
}

export async function createClimateCity(name: string) {
  if (!supabase) throw new Error('Supabase não está configurado.');
  const { error } = await supabase.from('climate_cities').insert({ name: name.trim() });
  if (error) throw error;
}

export async function deleteClimateCity(id: string) {
  if (!supabase) throw new Error('Supabase não está configurado.');
  const { error } = await supabase.from('climate_cities').delete().eq('id', id);
  if (error) throw error;
}

export async function replaceClimateRecords(cityId: string, rows: ClimateImportRow[]) {
  if (!supabase) throw new Error('Supabase não está configurado.');
  const { error: deleteError } = await supabase.from('climate_records').delete().eq('city_id', cityId);
  if (deleteError) throw deleteError;

  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500).map((row) => ({
      city_id: cityId,
      observation_date: row.observationDate,
      payload: row.data
    }));
    const { error } = await supabase.from('climate_records').insert(chunk);
    if (error) throw error;
  }

  const dates = rows.map((row) => row.observationDate).sort();
  const { error: summaryError } = await supabase.from('climate_cities').update({
    start_date: dates[0],
    end_date: dates[dates.length - 1],
    record_count: rows.length,
    updated_at: new Date().toISOString()
  }).eq('id', cityId);
  if (summaryError) throw summaryError;
}
