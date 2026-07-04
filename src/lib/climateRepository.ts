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
  const [citiesResult, recordsResult] = await Promise.all([
    supabase.from('climate_cities').select('id,name').order('name'),
    supabase.from('climate_records').select('city_id,observation_date')
  ]);
  if (citiesResult.error) throw citiesResult.error;
  if (recordsResult.error) throw recordsResult.error;

  return (citiesResult.data ?? []).map((city) => {
    const dates = (recordsResult.data ?? [])
      .filter((record) => record.city_id === city.id)
      .map((record) => record.observation_date)
      .filter(Boolean)
      .sort();
    return {
      id: city.id,
      name: city.name,
      startDate: dates[0] ?? null,
      endDate: dates[dates.length - 1] ?? null,
      recordCount: dates.length
    };
  });
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
}
