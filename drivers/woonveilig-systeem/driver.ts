import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import { WoonVeiligSettings } from './models/woonveiligsettings';
import { WoonVeiligRepository } from './repositories/woonveiligrepository';

class WoonVeiligDriver extends Homey.Driver {

  /**
   * onInit is called when the driver is initialized.
   */
  async onInit() {
    this.log('WoonVeilig driver has been initialized');
  }

  async onPair(session: PairSession) {
    let settings: WoonVeiligSettings;

    session.setHandler("login", async function(data: WoonVeiligSettings) : Promise<boolean> {
      settings = data;
      var repository = new WoonVeiligRepository(settings);
      return await repository.login();
    });

    session.setHandler("list_devices", async () => {
      return [{
        name: this.homey.__('deviceName'),
        data: {
          id: "woonveilig-system",
        },
        settings: settings
      }];
    });
  }
}

module.exports = WoonVeiligDriver;
