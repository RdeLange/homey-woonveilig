import Homey from 'homey';
import { WoonVeiligSettings } from './models/woonveiligsettings';
import { AlarmState, WoonVeiligRepository } from './repositories/woonveiligrepository';

class MyDevice extends Homey.Device {

  repository!: WoonVeiligRepository;
  runningInterval!: NodeJS.Timeout | null;

  /**
   * onInit is called when the device is initialized.
   */
  async onInit() {
    this.repository = new WoonVeiligRepository(this.getSettings());

    this.registerCapabilityListener('homealarm_state', async (value) => {
      await this.repository.login();
      switch(value) {
        case 'armed':
          await this.repository.setState(AlarmState.Armed);
          break;
        case 'disarmed':
          await this.repository.setState(AlarmState.Disarmed);
          break;
        case 'partially_armed':
          await this.repository.setState(AlarmState.PartiallyArmed);  
          break;
      }
    });

    this.repository.on('state-changed', (value: AlarmState) => {
      console.log('State changed to ' + AlarmState[value])
      switch(value) {
        case AlarmState.Armed:
          this.setCapabilityValue('homealarm_state', 'armed');
          break;
        case AlarmState.Disarmed:
          this.setCapabilityValue('homealarm_state', 'disarmed');
          break;
        case AlarmState.PartiallyArmed:
          this.setCapabilityValue('homealarm_state', 'partially_armed');
          break;
      }
    });

    this.repository.on('alarm-changed', (value : boolean) => {
      console.log('Alarm set to '+ value);
      this.setCapabilityValue('alarm_generic', value);
    });

    // Below code is not thread-safe, but it's good enough for now
    let isReadingEvents = false;
    this.runningInterval = this.homey.setInterval(async () => {
      if(isReadingEvents)
        return;

      isReadingEvents = true;
      try {
        var lastKnownLogDate = new Date(this.homey.settings.get('lastKnownLogDate'));
        console.log('Reading logs since ' + lastKnownLogDate);
        lastKnownLogDate = await this.repository.processLastLogs(lastKnownLogDate);
        this.homey.settings.set('lastKnownLogDate', lastKnownLogDate);
      }
      catch(error) {
        this.log(error);
      }
      isReadingEvents = false;
    }, 5000);

    this.log('WoonVeilig Systeem has been initialized');
  }

  /**
   * onAdded is called when the user adds the device, called just after pairing.
   */
  async onAdded() {
    this.homey.settings.set('lastKnownLogDate', new Date(1970, 0, 1));
    this.log('WoonVeilig Systeem has been added');
  }

  /**
   * onSettings is called when the user updates the device's settings.
   * @param {object} event the onSettings event data
   * @param {object} event.oldSettings The old settings object
   * @param {object} event.newSettings The new settings object
   * @param {string[]} event.changedKeys An array of keys changed since the previous version
   * @returns {Promise<string|void>} return a custom message that will be displayed
   */
  async onSettings({
    newSettings
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    var settings = new WoonVeiligSettings();
    settings.ipaddress = newSettings.ipaddress!.toString();
    settings.username = newSettings.username!.toString();
    settings.password = newSettings.password!.toString();
    var repository = new WoonVeiligRepository(settings);
    
    if(!await repository.login())
      throw new Error(this.homey.__('driverHuiscentrale.pairErrorConnecting'));

    this.repository = new WoonVeiligRepository(settings);
  }

  /**
   * onRenamed is called when the user updates the device's name.
   * This method can be used this to synchronise the name to the device.
   * @param {string} name The new name
   */
  async onRenamed(name: string) {
    this.log('WoonVeilig Systeem was renamed');
  }

  /**
   * onDeleted is called when the user deleted the device.
   */
  async onDeleted() {
    if(this.runningInterval != null)
      this.homey.clearInterval(this.runningInterval);

    this.log('WoonVeilig Systeem has been deleted');
  }
}

module.exports = MyDevice;
