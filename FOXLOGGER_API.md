================================================================================
                    FOXLOGGER API DOCUMENTATION
================================================================================

1. AUTHENTICATION / GET API KEY
--------------------------------------------------------------------------------
URL      : https://api-auth.foxlogger.app/users/authentication
Method   : GET
Auth     : Basic Auth (Input email and password account)

Response :
{
  "success": true,
  "message": "OK",
  "data": {
    "access_token": "[Bearer Token]",
    "refresh_token": "[Bearer Token]"
  }
}

NOTE: access_token yang didapat harus di-extract menggunakan JWT 
      supaya dapat data user_id-nya.

================================================================================

2. REFRESH TOKEN / REFRESH API KEY
--------------------------------------------------------------------------------
URL      : https://api-auth.foxlogger.app/users/refresh-token
Method   : POST
Body     : raw

Response :
{
  "success": true,
  "message": "Record found",
  "data": {
    // data token baru
  }
}

================================================================================

3. GET DEVICE LISTS
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/device-lists/[user_id]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "data": [
    {
      "activation_date": "0000-00-00",
      "device_id": 144145,
      "expired_date": "2025-03-15",
      "group_id": 0,
      "group_name": "",
      "imei": "0869066060205771",
      "is_deleted": false,
      "last_lat": 0,
      "last_long": 0,
      "last_update": "0000-00-00 00:00:00",
      "mileage": 0,
      "movement_status": "MISS",
      "note": "",
      "package_code": "",
      "package_name": "",
      "simcard_expired": "2025-03-15",
      "simcard_number": "628123451235",
      "technician": "",
      "tracker_type": "FL212",
      "updated_at": "0000-00-00 00:00:00",
      "updated_by_id": 0,
      "user_id": 83428,
      "vehicle_frame_number": "",
      "vehicle_fuel_consumption": 8,
      "vehicle_kir_expired": "",
      "vehicle_kir_number": "",
      "vehicle_machine_number": "",
      "vehicle_stnk_expired": "",
      "vehicle_stnk_number": "",
      "vehicle_type": "CAR",
      "vendor": false
    }
  ],
  "message": "Record found",
  "success": true
}

NOTE: user_id bisa didapatkan dari extract token jwt pada value access_token.

================================================================================

4. GET REAL TIME DATA (MQTT)
--------------------------------------------------------------------------------
URL      : wss://mqtt.foxlogger.app/mqtt
Port     : 443
User     : foxlist
Password : pecellele2021
Topic    : user_id

================================================================================

5. ACTIVE LIVE STREAM
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/send_instruct
Method   : POST
Body     : raw

Payload :
{
  "imei": "352503093112346",
  "command": "LIVE",
  "channel": 0
}

NOTES:
- Sesuaikan value imei dengan imei yang diinginkan.
- Parameter imei yang diinput harus TANPA angka 0 di depan.
  Contoh: IMEI "0352503093112346" -> input "352503093112346"
- Value channel bisa diisi dengan angka 0 atau 1 (dual camera).

================================================================================

6. CAMERA LIVE STREAM
--------------------------------------------------------------------------------
URL      : https://streamv.foxlogger.info/live/[channel]/[imei].flv
Method   : GET
Response : Video live stream

NOTES:
- Parameter imei tanpa angka 0 di depan.
- Parameter channel: 0 atau 1.

================================================================================

7. CAMERA HISTORY STREAM
--------------------------------------------------------------------------------

7.1 Generate File History
-------------------------
URL      : https://streamv-api.foxlogger.info/api/device/sendInstruct
Method   : POST
Body     : x-www-form-urlencoded

Parameters:
  imei         : 864993060030716
  cmdContent   : FILELIST
  serverFlagId : 1
  proNo        : 128
  platform     : web
  requestId    : 6
  cmdType      : normalIns
  token        : 123

7.2 Get File History
--------------------
URL      : https://api-v2.foxlogger.app/find_all_filelist?start_date=[yyyy-MM-dd hh:mm:ss]&end_date=[yyyy-MM-dd hh:mm:ss]&imei=[imei]&channel=[channel]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "data": {
    "detail": [
      {
        "file_channel": 1,
        "file_name": "2024_10_03_23_34_16_01.mp4",
        "file_time": "2024-10-03 23:34:16"
      },
      {
        "file_channel": 1,
        "file_name": "2024_10_03_23_35_16_01.mp4",
        "file_time": "2024-10-03 23:35:16"
      }
    ]
  }
}

7.3 Request Watch History
-------------------------
URL      : https://streamv-api.foxlogger.info/api/device/sendInstruct
Method   : POST
Body     : x-www-form-urlencoded

Parameters:
  imei         : 864993060030716
  cmdContent   : REPLAYLIST,[file_name]
  serverFlagId : 1
  proNo        : 128
  platform     : web
  requestId    : 6
  cmdType      : normalIns
  token        : 123

7.4 Watch History
-----------------
URL      : https://streamv.foxlogger.info/live/[imei].flv
Method   : GET

================================================================================

8. GET REPORT HISTORY
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-history?imei=[imei]&user_id=[user_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "Pesan": "",
  "data": [
    {
      "Dist": "0.00",
      "Mill": 28.84114,
      "Power": 5,
      "Speed": 1,
      "Temp": "",
      "addr": "Jalan Cideng Barat, RW 11, Cideng, Gambir, Jakarta Pusat, Daerah Khusus Ibukota Jakarta, Jawa, 10150, Indonesia",
      "engi": "ON",
      "lat": -6.166082859039307,
      "long": 106.81034851074219,
      "time": "2024-12-16 00:00:48"
    }
  ],
  "nama": "Respon",
  "status": 202
}

================================================================================

9. GET REPORT ROLLBACK
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-rollback?imei=[imei]&user_id=[user_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "data": [
    {
      "dir": 89,
      "eng": "OFF",
      "lat": -6.134161949157715,
      "lng": 106.95084381103516,
      "no": "1",
      "nopol": "B 2412 PFQ",
      "speed": "0",
      "time": "2025-08-26 00:00:34"
    },
    {
      "dir": 89,
      "eng": "OFF",
      "lat": -6.134161949157715,
      "lng": 106.95084381103516,
      "no": "2",
      "nopol": "B 2412 PFQ",
      "speed": "0",
      "time": "2025-08-26 00:00:35"
    }
  ]
}

================================================================================

10. GET REPORT POSITION
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-position/[user_id]?status=MOVE,PARK,OFF,MISS
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "data": [
    {
      "address": "Jalan Cideng Barat, RW 11, Cideng, Gambir, Jakarta Pusat, Daerah Khusus Ibukota Jakarta, Jawa, 10150, Indonesia",
      "drv": "",
      "drvphn": "085723853284",
      "imei": "0869066060205771",
      "last_upd": "2024-06-04 13:36:10",
      "lo_lat": "-6.166003",
      "lo_long": "106.810234",
      "no": 8,
      "nokir": "",
      "reg_date": "2024-02-12",
      "sim": "81112113551",
      "status": "PARK",
      "tgl_halo": "2025-02-12",
      "unit": "TEST 4G",
      "vin": ""
    }
  ],
  "message": "Record found",
  "success": true
}

NOTE: Ubah parameter user_id dan status sesuai dengan data yang diinginkan.

================================================================================

11. GET REPORT SPEED
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-speed?imei=[imei]&user_id=[user_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "Pesan": "Success",
  "data": [
    {
      "avgsped": "0.02",
      "dist": "0.465821",
      "from_time": "2024-05-16 00:00:03",
      "hour": "1",
      "maxspd": "9.00",
      "minspeed": "0.00",
      "minute": "20",
      "second": "42",
      "to_time": "2024-05-16 01:20:45"
    },
    {
      "avgsped": "0.00",
      "dist": "1.342999",
      "from_time": "2024-05-16 01:27:04",
      "hour": "5",
      "maxspd": "2.00",
      "minspeed": "0.00",
      "minute": "53",
      "second": "17",
      "to_time": "2024-05-16 07:20:21"
    }
  ],
  "nama": "Response",
  "status": 200,
  "total": "0.000000"
}

================================================================================

12. GET REPORT FUEL
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-fuel?imei=[imei]&user_id=[user_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]&param=8
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "Pesan": "",
  "data": {
    "dist": "0.465821",
    "from_time": "2024-05-16 00:00:03",
    "fuel": 0.058227624744176865,
    "hour": "1",
    "minute": "20",
    "second": "42",
    "to_time": "2024-05-16 01:20:45"
  },
  "nama": "Respon",
  "status": 202
}

================================================================================

13. GET LIST POI (Geo Fence)
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/geo-fences/[user_id]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "color": "#480f0f",
  "created_at": "2025-07-30 02:36:15",
  "email_target": "test@gmail.com",
  "id": 210975
}

================================================================================

14. GET REPORT POI BY AREA
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-poi?geofence_id=[geo_fence_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "Pesan": "",
  "data": [
    {
      "check_in": "2024-05-29 11:11:00",
      "check_out": "2024-05-29 11:16:04",
      "duration": "00 hours, 05 minutes, 00 seconds",
      "gps_name": "B 1234 TEST",
      "imei": "0352503093112346",
      "poi_name": "FOXLOGGER TOWER"
    }
  ],
  "nama": "Respon",
  "status": 202
}

NOTE: [geo_fence_id] didapat dari id pada response List POI.

================================================================================

15. GET REPORT POI BY DEVICE
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-poi?imei=[imei]&user_id=[user_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "Pesan": "",
  "data": [
    {
      "check_in": "2024-05-29 11:11:00",
      "check_out": "2024-05-29 11:16:04",
      "duration": "00 hours, 05 minutes, 00 seconds",
      "gps_name": "B 1234 TEST",
      "imei": "0352503093112346",
      "poi_name": "FOXLOGGER TOWER"
    },
    {
      "check_in": "2024-05-29 17:54:57",
      "check_out": "2024-05-30 06:06:54",
      "duration": "12 hours, 11 minutes, 00 seconds",
      "gps_name": "B 1234 TEST",
      "imei": "0352503093112346",
      "poi_name": "RUMAH"
    }
  ],
  "nama": "Respon",
  "status": 202
}

================================================================================

16. GET REPORT PARK
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-park?imei=[imei]&user_id=[user_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "Pesan": "Success",
  "data": [
    {
      "Loc": "[106.81092071533203,-6.166802883148193]",
      "addrs": "Jalan Cideng Timur, RW 05, Petojo Utara, Gambir, Jakarta Pusat, Daerah Khusus Ibukota Jakarta, Jawa, 10160, Indonesia",
      "from_time": "2024-05-15 09:32:53",
      "gps_name": "TEST 4G",
      "hour": "0",
      "minute": "30",
      "second": "10",
      "to_time": "2024-05-15 10:03:03"
    }
  ],
  "nama": "Response",
  "status": 200,
  "total": "1"
}

================================================================================

17. GET REPORT SUMMARY
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker/report-summary?imei=[imei]&user_id=[user_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "Response": "Respon",
  "Status": "202",
  "data": [
    {
      "distance": "0.00",
      "engine": "ON",
      "fo_addr": "Jalan Cideng Barat, RW 11, Cideng, Gambir, Jakarta Pusat, Daerah Khusus Ibukota Jakarta, Jawa, 10150, Indonesia",
      "from_lati": -6.166053771972656,
      "from_long": 106.8103256225586,
      "from_time": "2024-05-15 00:05:57",
      "fuel_usage": 0.00004712499867309816,
      "gps_name": "TEST 4G",
      "speed_avg": "0",
      "speed_max": "0",
      "speed_min": "0",
      "time_hour": "0",
      "time_minute": "0",
      "time_second": "31",
      "to_addr": "Jalan Cideng Barat, RW 11, Cideng, Gambir, Jakarta Pusat, Daerah Khusus Ibukota Jakarta, Jawa, 10150, Indonesia",
      "to_lati": -6.16605281829834,
      "to_long": 106.8103256225586,
      "to_time": "2024-05-15 00:06:28"
    },
    {
      "distance": "0.08",
      "engine": "ON",
      "fo_addr": "Jalan Cideng Barat, RW 11, Cideng, Gambir, Jakarta Pusat, Daerah Khusus Ibukota Jakarta, Jawa, 10150, Indonesia",
      "from_lati": -6.166053771972656,
      "from_long": 106.8103256225586,
      "from_time": "2024-05-15 00:06:37",
      "fuel_usage": 0.009454124607145786,
      "gps_name": "TEST 4G",
      "speed_avg": "0",
      "speed_max": "0",
      "speed_min": "0",
      "time_hour": "1",
      "time_minute": "13",
      "time_second": "11",
      "to_addr": "Jalan Cideng Barat, RW 11, Cideng, Gambir, Jakarta Pusat, Daerah Khusus Ibukota Jakarta, Jawa, 10150, Indonesia",
      "to_lati": -6.166100978851318,
      "to_long": 106.81047821044922,
      "to_time": "2024-05-15 01:19:48"
    }
  ],
  "sum": "1.13"
}

================================================================================

18. GET REPORT CONVENIENT
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker/report-convenient?imei=[imei]&user_id=[user_id]&time1=[yyyy-MM-dd hh:mm:ss]&time2=[yyyy-MM-dd hh:mm:ss]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "Pesan": "",
  "data": [
    {
      "dist": "0.00",
      "driver": "",
      "dur": "00:00:00",
      "fuel": "0",
      "idle": "433:13:57",
      "imei": "0869066060205771",
      "max": "0",
      "nopol": "TEST 4G",
      "park": "0",
      "sim": "81112113551"
    }
  ],
  "nama": "Respon",
  "status": 202
}

================================================================================

19. GET REPORT ALARM (Power Cut / Fuel Steal)
--------------------------------------------------------------------------------
URL      : https://api-v2.foxlogger.app/web-tracker-staging/report-cut-power/[user_id]
Method   : GET
Auth     : Bearer Token dari access_token

Response :
{
  "success": true,
  "message": "Record found",
  "data": [
    {
      "cr_ctow": "17073753941476",
      "cr_time": "2024-07-24 15:08:40",
      "cr_alm": "Power Cut Alarm",
      "cr_imei": "0869066060196830",
      "cr_cour": "17",
      "cr_dist": 0.000111194924,
      "cr_durt": 7,
      "cr_engi": "0",
      "cr_lati": "-6.166046",
      "cr_long": "106.810326",
      "cr_mill": 0.9731332,
      "cr_nopol": "FL778 FUEL SENSOR 2",
      "cr_nosim": "81190014823",
      "cr_signal": "4",
      "cr_sped": "0.000000",
      "cr_status": "MOVE",
      "cr_suhu": 0,
      "cr_trip": "1721833713",
      "cr_voltage": "5"
    },
    {
      "cr_ctow": "17073753941476",
      "cr_time": "2024-07-22 16:33:01",
      "cr_alrm": "Fuel Steal Alarm",
      "cr_imei": "0869066060196830",
      "cr_cour": "245",
      "cr_dist": 0.000022238984,
      "cr_durt": 25,
      "cr_engi": "1",
      "cr_lati": "-6.166054",
      "cr_long": "106.810371",
      "cr_mill": 3.5528224,
      "cr_nopol": "FL778 FUEL SENSOR 2",
      "cr_nosim": "81190014823",
      "cr_signal": "4",
      "cr_sped": "0.000000",
      "cr_status": "MOVE",
      "cr_suhu": 0,
      "cr_trip": "1721606454",
      "cr_voltage": "5"
    }
  ]
}

NOTE: Akan ada perubahan pada endpoint ini dalam waktu dekat. 
      Jika ada perubahan akan segera dikabari.

================================================================================
                           END OF DOCUMENTATION
================================================================================Gateway ID Mapping:
  IMEI → parseInt(IMEI, 10) → simulated numeric ID
  simulated ID → resolveImei() or String(id).padStart(16, '0') → IMEI asli
