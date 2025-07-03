import axios from 'axios';
import appConfig from '../../../config/app.config';

const DVLA_API_KEY = appConfig().dvla.api_key;
const DVLA_VEHICLE_URL =
  'https://driver-vehicle-licensing.api.gov.uk/vehicle-enquiry/v1/vehicles';
const DVLA_MOT_URL =
  'https://beta.check-mot.service.gov.uk/trade/vehicles/mot-tests';

export class DvlaService {
  static async getVehicleDetails(registrationNumber: string) {
    const response = await axios.post(
      DVLA_VEHICLE_URL,
      { registrationNumber },
      {
        headers: {
          'x-api-key': DVLA_API_KEY,
          'Content-Type': 'application/json',
        },
      },
    );
    return response.data;
  }

  static async getMotHistory(registrationNumber: string) {
    const response = await axios.get(
      `${DVLA_MOT_URL}?registration=${registrationNumber}`,
      {
        headers: {
          'x-api-key': DVLA_API_KEY,
        },
      },
    );
    return response.data;
  }
}
