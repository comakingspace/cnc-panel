npm install
sudo cp cnc_panel.service /etc/systemd/system/cnc_panel.service
sudo systemctl daemon-reload
sudo systemctl enable cncjs_custom.service
sudo systemctl start cncjs_custom