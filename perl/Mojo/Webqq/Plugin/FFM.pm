package Mojo::Webqq::Plugin::FFM;
our $AUTHOR   = 'rikka@shizuku.moe';
our $SITE     = '';
our $DESC     = '';
our $PRIORITY = 97;

sub call {
    my $client = shift;
    my $data   = shift;
    my $api_url = $data->{api_url};
	
    $client->on(
        receive_message => sub {
            my ( $client, $msg ) = @_;
			
            my %chat;

            $chat{message}{sender}    = $msg->sender->displayname;
            $chat{message}{content}   = $msg->content;
            $chat{message}{timestamp} = $msg->time;
			
			if ($client->user->id eq $msg->sender->id) {
				return;
			}
			
            if ( $msg->is_at ) {
                $chat{message}{isAt} = 1;
            }
            if ( $msg->type eq 'friend_message' ) {
                $chat{type} = 0;
                $chat{id}   = $msg->sender->id;
                $chat{uid}  = $msg->sender->uid;
                $chat{name} = $msg->sender->displayname;
            }
            elsif ( $msg->type eq 'group_message' ) {
                $chat{type} = 1;
                $chat{id}   = $msg->group->id;
                $chat{uid}  = $msg->group->uid;
                $chat{name} = $msg->group->displayname;
            }
            elsif ( $msg->type eq 'discuss_message' ) {
                $chat{type} = 2;
                $chat{id}   = $msg->discuss->id;
                $chat{name} = $msg->discuss->displayname;
            }
            elsif ( $msg->type eq 'sess_message' ) {
            }

            $client->http_post( $api_url, { json => 1 }, json => \%chat );
        }
    );

    $client->on(
        all_event => sub {
            my ( $client, $event, @args ) = @_;

            if (    $event ne 'login'
                and $event ne 'input_qrcode'
                and $event ne 'stop' )
            {
                return;
            }

            my %chat;
            $chat{type}               = 3;
            $chat{message}{sender}    = $event;
            $chat{message}{timestamp} = time();
            if ( $event eq 'input_qrcode' ) {
                print "[FFM] QRCode Link: http://localhost:5004/ffm/get_qr_code\n";
                $chat{message}{content} = "";
            }

            $client->http_post(
                $api_url,
                {
                    json                  => 1,
                    blocking              => 1,
                    ua_connect_timeout    => 5,
                    ua_request_timeout    => 5,
                    ua_inactivity_timeout => 5,
                    ua_retry_times        => 1
                },
                json => \%chat
            );
        }
    );
}
1;
